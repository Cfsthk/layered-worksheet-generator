"use strict";
// A file:// page cannot load the bundled modules and PDF workers reliably.
// Opening the downloaded HTML takes the teacher to the working hosted app.
// No worksheet, credentials or local path are included in this navigation.
if (location.protocol === "file:") {
  location.replace("https://cfsthk.github.io/layered-worksheet-generator/?release=4.5");
}
