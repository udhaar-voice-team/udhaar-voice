import type { Transcription } from "@/lib/api/contract";

/**
 * What speech-to-text "hears" until a model is connected: the clip is uploaded but not read,
 * and each recording returns one of these.
 */
export const SAMPLE_TRANSCRIPTIONS: Transcription[] = [
  { text: "Kaun is hafte dega?", language: "hi" },
  { text: "এই সপ্তাহে কে দেবে?", language: "bn" },
  { text: "Ramesh ka kitna baaki hai?", language: "hi" },
  { text: "আজ কত টাকা এল?", language: "bn" },
  { text: "Who broke a promise?", language: "en" },
];
