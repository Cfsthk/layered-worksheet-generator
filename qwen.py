"""International Qwen transport. No key persistence, redirects or provider SDK required."""
import json
import math
import re
import ssl
import threading
import urllib.error
import urllib.request
from domain import AppError

DEFAULTS = {"vision": ["qwen3-vl-plus", "qwen3-vl-plus-2025-12-19"],
            "language": ["qwen3.7-plus", "qwen3.6-plus", "qwen-plus"]}
# Conservative highest published input/output tiers, USD per million tokens.
# Static reference, not a provider billing guarantee. Checked 2026-09-06.
RATES = {"qwen3.7-plus": (0.826, 3.301), "qwen3.6-plus": (1.101, 6.602),
         "qwen-plus": (1.2, 12.0), "qwen3-vl-plus": (0.6, 4.8),
         "qwen3-vl-plus-2025-12-19": (0.6, 4.8)}


def config(value):
    value = value if isinstance(value, dict) else {}
    workspace = str(value.get("workspace", "")).strip()
    if workspace and not re.fullmatch(r"[A-Za-z0-9-]{1,80}", workspace):
        raise AppError("Workspace ID 只可使用英文字母、數字及連字號。")
    models = value.get("models", {})
    if not isinstance(models, dict):
        raise AppError("模型設定格式錯誤。")
    for service in DEFAULTS:
        model = models.get(service, "")
        if not isinstance(model, str) or (model and not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,150}", model)):
            raise AppError("Model ID 格式錯誤。")
    try:
        cost = float(value.get("cost", 1))
    except (ValueError, TypeError):
        raise AppError("費用提示門檻格式錯誤。") from None
    if not math.isfinite(cost) or not 0 <= cost <= 100:
        raise AppError("費用提示門檻必須介乎 US$0 至 US$100。")
    return {"workspace": workspace, "models": {s: models.get(s, "") for s in DEFAULTS},
            "fallback": value.get("fallback", True) is True, "cost": cost}


def host(settings):
    return (settings["workspace"] + ".ap-southeast-1.maas.aliyuncs.com") if settings["workspace"] else "dashscope-intl.aliyuncs.com"


def models(settings, service):
    selected = settings["models"][service]
    candidates = ([selected] if selected else [DEFAULTS[service][0]])
    if settings["fallback"]:
        candidates += DEFAULTS[service]
    return list(dict.fromkeys(candidates))[:4]


def estimate(settings, service, input_chars, image_count, output_tokens, calls=1):
    # UTF-8 byte count (supplied by caller) + large per-image allowance deliberately
    # overestimates typical tokenization. Include every allowed fallback attempt.
    input_tokens = input_chars + image_count * 16384 + 2000
    candidates = models(settings, service)
    if any(m not in RATES for m in candidates):
        return None
    cost = sum(input_tokens * RATES[m][0] + output_tokens * RATES[m][1] for m in candidates) * calls / 1_000_000
    return math.ceil(cost * 1000) / 1000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AppError("供應商回傳重新導向，為避免跨區傳送已停止。", "redirect_blocked", 502)


def send_http(url, key, body, timeout):
    request = urllib.request.Request(url, json.dumps(body, ensure_ascii=False).encode(),
                                     {"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read(4_000_001)
            if len(raw) > 4_000_000:
                raise AppError("模型回覆過長，請縮短工作紙。", "invalid_output", 502)
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        if error.code in {401, 403}:
            raise AppError("金鑰無效、區域不符或沒有模型權限。請檢查國際區域的 Qwen API Key 及 Workspace。", "authentication", 401) from None
        if error.code == 429:
            raise AppError("模型目前繁忙或額度不足。", "rate_limited", 429) from None
        if error.code in {400, 404, 422}:
            raise AppError("這個模型不支援本次請求，或未在國際 Workspace 開通。", "model_unavailable", 502) from None
        raise AppError(f"模型服務暫時無法使用（HTTP {error.code}）。", "provider_error", 502) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise AppError("未能連接國際 Qwen 服務，請檢查網絡後重試。", "network_error", 502) from None
    except (ValueError, KeyError):
        raise AppError("供應商回覆格式無效。", "invalid_output", 502) from None


class Client:
    def __init__(self, settings, key, cancel=None, transport=None):
        if not isinstance(key, str) or not 8 <= len(key) <= 512 or any(ord(c) < 33 or ord(c) > 126 for c in key):
            raise AppError("請先輸入你的 Qwen API Key。", "missing_key", 401)
        self.settings, self.key = settings, key
        self.cancel = cancel or threading.Event()
        self.transport = transport or send_http

    def chat(self, service, system, user, images=None, max_tokens=12000):
        notes = []
        content = [{"type": "text", "text": user}]
        for image in images or []:
            content.append({"type": "image_url", "image_url": {"url": image}})
        candidates = models(self.settings, service)
        for index, model in enumerate(candidates):
            if self.cancel.is_set():
                raise AppError("已取消。已提交的模型請求仍可能計費。", "cancelled", 409)
            body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
                    "response_format": {"type": "json_object"}, "enable_thinking": False,
                    "max_tokens": max_tokens, "stream": False}
            try:
                result = self.transport(f"https://{host(self.settings)}/compatible-mode/v1/chat/completions", self.key, body, 75)
                choice = result["choices"][0]
                if choice.get("finish_reason") == "length":
                    raise AppError("模型回覆被長度限制截斷。請減少題目後重試。", "truncated_output", 502)
                output = choice["message"]["content"]
                if not isinstance(output, str):
                    raise ValueError("Non-text model output")
                output = re.sub(r"^```(?:json)?\s*|\s*```$", "", output.strip())
                value = json.loads(output)
                if not isinstance(value, dict):
                    raise ValueError("Expected object")
                if self.cancel.is_set():
                    raise AppError("已取消。已提交的模型請求仍可能計費。", "cancelled", 409)
                return value, {"model": model, "usage": result.get("usage", {}), "notes": notes}
            except (ValueError, KeyError, IndexError, TypeError):
                error = AppError("模型沒有回傳完整 JSON 資料，請重試。", "invalid_output", 502)
            except AppError as caught:
                error = caught
            # Do not multiply charges on a malformed/truncated reply or retry an
            # ambiguous network timeout. Fallback is for explicit unavailability.
            if error.code not in {"model_unavailable", "rate_limited", "provider_error"} or index == len(candidates)-1:
                raise error
            notes.append(f"{model} 無法使用，已切換至 {candidates[index+1]}。")
        raise AppError("沒有可用模型。", "model_unavailable", 502)
