/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface SpeechRecognition extends EventTarget {
  lang: string
  interimResults: boolean
  start(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: (() => void) | null
}
interface SpeechRecognitionEvent extends Event { results: SpeechRecognitionResultList }
interface Window { SpeechRecognition?: new () => SpeechRecognition }
