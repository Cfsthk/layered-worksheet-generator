"""Small, explicit data contract shared by Qwen and Word export."""
import re
from fractions import Fraction


class AppError(Exception):
    def __init__(self, message, code="invalid_request", status=400):
        super().__init__(message)
        self.code, self.status = code, status


def text(value, name, limit=4000, required=False):
    if not isinstance(value, str) or len(value) > limit:
        raise AppError(f"{name} 必須是文字，最多 {limit} 字。")
    value = value.strip()
    if required and not value:
        raise AppError(f"請填寫 {name}。")
    # XML 1.0 control characters cannot be exported to Word.
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)


def integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise AppError(f"{name} 必須介乎 {low} 至 {high}。")
    return value


def diagram(value):
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("type") != "fraction_bars":
        raise AppError("圖解格式未能辨識。", "invalid_output")
    pairs = value.get("fractions")
    if not isinstance(pairs, list) or not 1 <= len(pairs) <= 4:
        raise AppError("分數圖解需要 1 至 4 個分數。", "invalid_output")
    for pair in pairs:
        if not isinstance(pair, list) or len(pair) != 2:
            raise AppError("分數圖解格式錯誤。", "invalid_output")
        integer(pair[1], "分母", 1, 60)
        integer(pair[0], "分子", 0, pair[1])
    return {"type": "fraction_bars", "fractions": pairs,
            "caption": text(value.get("caption", ""), "圖解說明", 300)}


def question(value, position, require_answer=False):
    if not isinstance(value, dict):
        raise AppError("題目格式錯誤。", "invalid_output")
    q = {
        "id": text(value.get("id", f"q{position + 1}"), "題號", 60, True),
        "section": text(value.get("section", "練習"), "題組", 200, True),
        "prompt": text(value.get("prompt", ""), "題目", 5000, True),
        "answer": text(value.get("answer", ""), "答案", 4000, require_answer),
        "explanation": text(value.get("explanation", ""), "解說", 4000),
        "hint": text(value.get("hint", ""), "提示", 2000),
        "workLines": integer(value.get("workLines", 2), "作答行數", 0, 8),
        "diagram": diagram(value.get("diagram")),
    }
    return q


def worksheet(value, require_answers=False):
    if not isinstance(value, dict):
        raise AppError("模型未有提供工作紙資料。", "invalid_output")
    qs = value.get("questions")
    if not isinstance(qs, list) or not 1 <= len(qs) <= 60:
        raise AppError("每份工作紙須有 1 至 60 題。請分開較長的工作紙。", "invalid_output")
    subject = value.get("subject", "maths")
    if subject not in {"maths", "chinese", "english"}:
        raise AppError("請選擇數學、中文或英文科。")
    result = {
        "topic": text(value.get("topic", ""), "主題", 180, True),
        "objective": text(value.get("objective", ""), "學習目標", 2000, True),
        "summary": text(value.get("summary", ""), "內容摘要", 4000),
        "context": text(value.get("context", ""), "閱讀材料", 20000),
        "grade": integer(value.get("grade", 4), "年級", 1, 6),
        "subject": subject,
        "questions": [question(q, i, require_answers) for i, q in enumerate(qs)],
    }
    ids = [q["id"] for q in result["questions"]]
    if len(set(ids)) != len(ids):
        raise AppError("題號重複，請重新讀取工作紙。", "invalid_output")
    notices = value.get("notices", [])
    if not isinstance(notices, list) or len(notices) > 20:
        raise AppError("讀取提示格式錯誤。", "invalid_output")
    result["notices"] = [text(n, "讀取提示", 800) for n in notices]
    return result


def checked_version(value, source, level, extension=False):
    result = worksheet(value, require_answers=True)
    if [q["id"] for q in result["questions"]] != [q["id"] for q in source["questions"]]:
        raise AppError("模型改變了題目數量或順序，這個版本未被接受。請重試。", "alignment_failed")
    if result["objective"] != source["objective"]:
        raise AppError("模型改變了確認的學習目標，這個版本未被接受。請重試。", "alignment_failed")
    if result["grade"] != source["grade"] or result["subject"] != source["subject"]:
        raise AppError("模型改變了年級或科目，請重試。", "alignment_failed")
    # Deterministic check for a narrow, unambiguous symbolic comparison only.
    for q in result["questions"]:
        match = re.fullmatch(r"\s*(\d+)\s*[/／]\s*(\d+)\s*[○◯□]\s*(\d+)\s*[/／]\s*(\d+)\s*", q["prompt"])
        if match:
            a, b, c, d = map(int, match.groups())
            if b == 0 or d == 0:
                raise AppError("模型產生了零分母，這個版本未被接受。", "invalid_output")
            relation = "＞" if Fraction(a, b) > Fraction(c, d) else "＜" if Fraction(a, b) < Fraction(c, d) else "＝"
            q["answer"] = f"{a}/{b} {relation} {c}/{d}"
            q["explanation"] = f"交叉相乘：{a} × {d} ＝ {a*d}；{c} × {b} ＝ {c*b}。"
    extra = value.get("extension")
    result["extension"] = None
    if extension and extra:
        result["extension"] = {
            "objective": text(extra.get("objective", ""), "延伸目標", 1000, True),
            "question": question(extra.get("question"), 60, True),
        }
    result["level"] = level
    return result


QUESTION_EXAMPLE = {
    "id": "q1", "section": "比較分數", "prompt": "2/3 ○ 3/5",
    "answer": "2/3 ＞ 3/5", "explanation": "通分後比較。", "hint": "先找共同分母。",
    "workLines": 2, "diagram": {"type": "fraction_bars", "fractions": [[2, 3], [3, 5]], "caption": "同樣長的整體"},
}
WORKSHEET_EXAMPLE = {"topic": "分數比較", "objective": "比較異分母分數的大小。", "summary": "", "context": "",
                     "grade": 4, "subject": "maths", "questions": [QUESTION_EXAMPLE], "notices": []}
