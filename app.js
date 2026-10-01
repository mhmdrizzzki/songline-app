"use strict";

// Bring Your Own Pollen: OAuth + PKCE in the browser, no backend, no proxy.
const CLIENT_ID = "pk_Gp69Edu2tACjJUKY";
const REDIRECT = location.origin + location.pathname;
const AUTH_URL = "https://enter.pollinations.ai/authorize";
const TOKEN_URL = "https://enter.pollinations.ai/api/oauth/token";
const API = "https://gen.pollinations.ai";

const TEXT_MODEL = "openai/gpt-5.4-nano";
const TTS_MODEL = "openai/tts-1";
const STT_MODEL = "openai/gpt-transcribe";
const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

const b64u = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").split("/").join("_").replace(/=+$/, "");
const randB = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); };
const s256 = async (v) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("sl_token") || "";
let login = localStorage.getItem("sl_login") || "";
let song = null;
let lastUrl = null;

/* ---------- sign in ---------- */
async function signIn() {
  const verifier = randB(32);
  localStorage.setItem("pkce_v", verifier);
  const q = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT,
    scope: "profile usage", state: randB(16),
    code_challenge: await s256(verifier), code_challenge_method: "S256"
  });
  location.href = AUTH_URL + "?" + q.toString();
}

async function handleCallback() {
  const p = new URLSearchParams(location.search);
  const code = p.get("code");
  if (!code || token) return;
  const verifier = localStorage.getItem("pkce_v") || "";
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier }).toString()
  });
  const d = await r.json();
  if (d.access_token) {
    token = d.access_token;
    localStorage.setItem("sl_token", token);
    history.replaceState(null, "", location.pathname);
  }
  authUI();
}

function authUI() {
  const s = $("status");
  if (token) {
    s.textContent = "Signed in — your own Pollen pays for the lyrics and the music.";
    $("signin").textContent = "Sign out";
  } else {
    s.textContent = "Sign in with Pollinations to make a song. Your own Pollen pays for the writing and the music.";
    $("signin").textContent = "Sign in with Pollinations";
  }
}


/* ---------- styles worth trying ---------- */
const STYLES = [
  ["bubblegum pop", "bright, hand claps, one earworm hook"],
  ["boom bap rap", "dry drums, spoken verses, chanted hook"],
  ["sea shanty", "call and response, accordion, group chorus"],
  ["lullaby", "soft, slow, humming between lines"],
  ["synthwave", "analog bass, gated snare, neon chorus"]
];
$("style").innerHTML = STYLES.map(function (s, i) { return '<option value="' + i + '">' + s[0] + "</option>"; }).join("");

const MUSIC_MODEL = "google/lyria-3-clip-preview";

async function chat(system, user, max) {
  const r = await fetch(API + "/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.7, max_tokens: max || 600,
      messages: [{ role: "system", content: system }, { role: "user", content: user }] })
  });
  if (!r.ok) throw new Error("model " + r.status);
  const d = await r.json();
  const text = ((d.choices || [])[0] || {}).message ? (d.choices[0].message.content || "") : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("the model did not return JSON");
  return JSON.parse(m[0]);
}

/* ---------- write the song ---------- */
function writerPrompt(st) {
  return "You write very short songs that make facts stick. Reply with JSON only, no prose: " +
    '{"title":"...","hook":"one repeatable line","verses":[["line","line"],["line","line"]],"facts":["the one fact each verse locks in"]}. ' +
    "Rules: under 60 words in total; the hook carries the single most important fact; every verse is two short lines and covers one fact from the notes, keeping its exact wording where it matters; sing it in the style " + st[0] + " (" + st[1] + ").";
}

function lyricText(s) {
  const verses = (s.verses || []).map(function (v) { return (Array.isArray(v) ? v : [String(v)]).join("\n"); }).join("\n\n");
  return s.hook + "\n\n" + verses + "\n\n" + s.hook;
}

async function makeMusic(s, styleName) {
  const brief = "A 30 second " + styleName + " song with clear vocals, hook and two short verses. " + lyricText(s).replace(/\n+/g, " ");
  const r = await fetch(API + "/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ model: MUSIC_MODEL, input: brief, response_format: "mp3" })
  });
  if (!r.ok) throw new Error("music model " + r.status);
  return URL.createObjectURL(await r.blob());
}

/* ---------- fallback voice, so the app never dead-ends ---------- */
async function speakDemo(s) {
  const r = await fetch(API + "/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ model: TTS_MODEL, voice: "nova", input: lyricText(s), response_format: "mp3" })
  });
  if (!r.ok) throw new Error("voice " + r.status);
  return URL.createObjectURL(await r.blob());
}

/* ---------- put it on screen, with words to hide ---------- */
function lineEl(line) {
  const p = document.createElement("p");
  const words = line.split(" ");
  words.forEach(function (w, i) {
    if (i) p.appendChild(document.createTextNode(" "));
    const s = document.createElement("span");
    s.textContent = w;
    if (w.replace(/[^A-Za-z0-9]/g, "").length > 4) {
      s.className = "blank";
      s.onclick = function () { s.classList.add("shown"); };
    }
    p.appendChild(s);
  });
  return p;
}

function render(s, styleName) {
  $("songbox").hidden = false;
  $("songtitle").textContent = s.title || "Untitled";
  $("songsstyle").textContent = styleName + (s.facts && s.facts.length ? " - locks in: " + s.facts.join("; ") : "");
  const lyr = $("lyrics");
  lyr.innerHTML = "";
  lyricText(s).split("\n").forEach(function (l) {
    if (!l.trim()) { lyr.appendChild(document.createElement("p")); return; }
    lyr.appendChild(lineEl(l));
  });
}

/* ---------- the shelf of songs you already made ---------- */
function saved() { try { return JSON.parse(localStorage.getItem("sl_songs") || "[]"); } catch (e) { return []; } }
function saveSong(s, st) {
  const a = saved().filter(function (x) { return x.t !== (s.title || "Untitled"); });
  a.unshift({ t: s.title || "Untitled", st: st, s: s });
  localStorage.setItem("sl_songs", JSON.stringify(a.slice(0, 8)));
  renderList();
}

function renderList() {
  const a = saved(), box = $("playlist");
  if (!a.length) { box.innerHTML = '<p class="dim">Songs you make are kept here, in this browser.</p>'; return; }
  box.innerHTML = "";
  a.forEach(function (x) {
    const b = document.createElement("button");
    b.className = "ghost";
    b.textContent = x.t + " - " + x.st;
    b.onclick = function () { song = x.s; render(x.s, x.st); };
    box.appendChild(b);
  });
}

/* ---------- the one button that matters ---------- */
$("song").onclick = async function () {
  if (!token) { signIn(); return; }
  const notes = $("notes").value.trim();
  if (notes.length < 8) { $("status").textContent = "Paste a line or two of facts first."; return; }
  const st = STYLES[Number($("style").value) || 0];
  $("song").disabled = true;
  $("status").textContent = "Writing the song...";
  try { song = await chat(writerPrompt(st), "Notes:\n" + notes, 500); }
  catch (e) { $("song").disabled = false; $("status").textContent = "could not write it (" + e.message + ") - try again"; return; }
  render(song, st[0]);
  saveSong(song, st[0]);
  $("status").textContent = "Setting it to music...";
  try {
    lastUrl = await makeMusic(song, st[0]);
    $("player").src = lastUrl;
    $("audionote").textContent = "Thirty seconds, " + st[0] + ".";
  } catch (e) {
    try {
      lastUrl = await speakDemo(song);
      $("player").src = lastUrl;
      $("audionote").textContent = "The music model is not on your Pollen tier (" + e.message + "), so here is the same song spoken - identical words.";
    } catch (e2) { $("audionote").textContent = "Audio failed: " + e2.message; }
  }
  $("song").disabled = false;
  $("status").textContent = "Done - your own Pollen paid for one song.";
};

$("quiz").onclick = function () {
  const on = $("lyrics").classList.toggle("quiz");
  document.querySelectorAll("#lyrics .blank").forEach(function (b) { b.classList.remove("shown"); });
  $("quiz").textContent = on ? "Show the words" : "Quiz me";
  $("status").textContent = on ? "Quiz mode: click a bar to reveal that word." : "Quiz mode off.";
};

$("signin").onclick = function () {
  if (token) { token = ""; login = ""; localStorage.removeItem("sl_token"); localStorage.removeItem("sl_login"); authUI(); return; }
  signIn();
};

renderList();
authUI();
handleCallback();
