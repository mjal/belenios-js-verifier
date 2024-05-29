export const assert = console.assert;

export function log(section, message, classeName = "", prefix = "") {
  const p = document.createElement("p");
  p.className = classeName;
  p.textContent = prefix + message;
  document.getElementById(section).appendChild(p);
}

export function logSuccess(section, message) {
  log(section, message, "success", "✔ ");
}

let errors = 0;
export function logError(section, message) {
  log(section, message, "error", "✘ ");
  errors++;
}

export function check(section, message, test, log = false) {
  if (test) {
    if (log) {
      logSuccess(section, message);
    }
  } else {
    logError(section, message);
  }
}

export function getErrors() {
  return errors;
}

export function clear() {
  errors = 0;
  document.getElementById("top").innerHTML = "";
  document.getElementById("database").innerHTML = "";
  document.getElementById("setup").innerHTML = "";
  document.getElementById("ballots").innerHTML = "";

  logSuccess("top", "In progress...");
}

export function showResult() {
  if (errors === 0) {
    logSuccess("top", "Finished. All checks passed.");
  } else {
    logError("top", "Finished. Some checks failed.");
  }
}

export async function _async(f, ...args) {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      f(...args);
      resolve();
    });
  });
}
