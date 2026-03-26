// Browser-native voice I/O — no API key required.
// SpeechRecognition (STT): Chrome / Edge / Safari
// SpeechSynthesis (TTS): all modern browsers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = any;

const _v = {
  recognition: null as AnyRec | null,
  listening: false,
  ttsEnabled: false,
};

export function isSpeechInputSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isVoiceListening(): boolean {
  return _v.listening;
}

export function isTtsEnabled(): boolean {
  return _v.ttsEnabled;
}

function updateMicButton(active: boolean) {
  const btn = document.querySelector<HTMLButtonElement>(".chat-mic-btn");
  if (!btn) return;
  btn.classList.toggle("active", active);
  btn.title = active ? "Stop listening" : "Voice input";
  btn.setAttribute("aria-pressed", String(active));
}

function updateTtsButton(enabled: boolean) {
  const btn = document.querySelector<HTMLButtonElement>(".chat-tts-btn");
  if (!btn) return;
  btn.classList.toggle("active", enabled);
  btn.title = enabled ? "Auto-read on (click to disable)" : "Read responses aloud";
  btn.setAttribute("aria-pressed", String(enabled));
}

export function toggleVoiceInput(draft: string, onDraftChange: (v: string) => void) {
  if (_v.listening && _v.recognition) {
    _v.recognition.stop();
    return; // onend will clean up state
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  const SpeechRecCls = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  if (!SpeechRecCls) return;

  const rec = new SpeechRecCls();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onresult = (e: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transcript = Array.from(e.results as any[])
      .slice(e.resultIndex)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => r.isFinal)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => String(r[0].transcript))
      .join(" ")
      .trim();
    if (transcript) {
      const sep = draft.trim() ? " " : "";
      onDraftChange(draft + sep + transcript);
    }
  };

  rec.onend = () => {
    _v.listening = false;
    _v.recognition = null;
    updateMicButton(false);
  };
  rec.onerror = rec.onend;

  rec.start();
  _v.recognition = rec;
  _v.listening = true;
  updateMicButton(true);
}

export function toggleTtsEnabled() {
  _v.ttsEnabled = !_v.ttsEnabled;
  updateTtsButton(_v.ttsEnabled);
  if (!_v.ttsEnabled && isTtsSupported()) {
    window.speechSynthesis.cancel();
  }
}

// Strip markdown syntax so it isn't read literally (headers, bold, code fences, etc.)
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/`[^`]*`/g, "") // inline code
    .replace(/!\[.*?\]\(.*?\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> label
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // bold/italic/strike
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*\d+\.\s+/gm, "") // ordered list
    .replace(/^\s*>/gm, "") // blockquotes
    .replace(/\n{2,}/g, ". ") // paragraph breaks → pause
    .replace(/\n/g, " ")
    .trim();
}

// speakText: always speaks immediately (per-message button).
// When called from the auto-TTS path (chat:final), _v.ttsEnabled must be true.
export function speakText(text: string, { requireEnabled = true } = {}) {
  if (!isTtsSupported() || !text.trim()) return;
  if (requireEnabled && !_v.ttsEnabled) return;
  window.speechSynthesis.cancel();
  const clean = stripMarkdown(text);
  if (!clean) return;
  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate = 1.05;
  window.speechSynthesis.speak(utt);
}
