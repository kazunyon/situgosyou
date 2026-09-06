import { useCallback, useEffect, useRef, useState } from 'react'
import { loadReadingSpeed, READING_RATES, READING_SPEED_KEY, speechChunks, spokenMeaning, type ReadingSpeed } from './readAloud'

type ReadingTarget = 'title' | 'meaning'

export function useReadAloud(title: string, meaning: string) {
  const supported = typeof window.speechSynthesis?.speak === 'function'
    && typeof window.speechSynthesis?.cancel === 'function'
    && typeof window.SpeechSynthesisUtterance === 'function'
  const [speed, setSpeed] = useState<ReadingSpeed>(loadReadingSpeed)
  const [active, setActive] = useState<ReadingTarget | null>(null)
  const [message, setMessage] = useState('')
  const [preferenceMessage, setPreferenceMessage] = useState('')
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const activeTarget = useRef<ReadingTarget | null>(null)
  const generation = useRef(0)
  const explanation = spokenMeaning(meaning)

  const cancel = useCallback(() => {
    generation.current += 1
    activeTarget.current = null
    if (utterance.current) {
      utterance.current.onend = null
      utterance.current.onerror = null
      utterance.current = null
      window.speechSynthesis.cancel()
    }
  }, [])

  const stop = useCallback(() => {
    cancel()
    setActive(null)
    setMessage('')
  }, [cancel])

  useEffect(() => { stop(); return cancel }, [title, meaning, stop, cancel])
  useEffect(() => {
    const onVisibilityChange = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', stop)
    }
  }, [stop])

  const start = (target: ReadingTarget, readingSpeed = speed) => {
    stop()
    if (!supported) { setMessage('このブラウザでは読み上げを利用できません。'); return }
    const chunks = speechChunks(target === 'title' ? title : explanation)
    if (chunks.length === 0) { setMessage('読み上げることばや説明がありません。'); return }
    const synth = window.speechSynthesis
    const requestId = generation.current
    activeTarget.current = target
    setActive(target)
    setMessage(target === 'title' ? 'ことばを読み上げています。' : '説明を読み上げています。')

    const finish = (error = false) => {
      if (requestId !== generation.current) return
      generation.current += 1
      utterance.current = null
      activeTarget.current = null
      setActive(null)
      setMessage(error ? '読み上げできませんでした。端末の音声設定を確認して、もう一度お試しください。' : '')
    }
    const speakChunk = (index: number) => {
      if (requestId !== generation.current) return
      try {
        const next = new SpeechSynthesisUtterance(chunks[index])
        next.lang = 'ja-JP'
        next.rate = READING_RATES[readingSpeed]
        const voices = synth.getVoices().filter((voice) => /^ja(?:[-_]|$)/i.test(voice.lang))
        const voice = voices.find((item) => item.localService) ?? voices[0]
        if (voice) next.voice = voice
        next.onend = () => {
          if (requestId !== generation.current) return
          if (index + 1 < chunks.length) speakChunk(index + 1)
          else finish()
        }
        next.onerror = () => finish(true)
        utterance.current = next
        synth.speak(next)
      } catch { finish(true) }
    }
    // Start synchronously in the button event for mobile browsers.
    try { synth.cancel(); speakChunk(0) } catch { finish(true) }
  }

  const toggle = (target: ReadingTarget) => {
    if (activeTarget.current === target) stop()
    else start(target)
  }

  const changeSpeed = (next: ReadingSpeed) => {
    if (next === speed) return
    setSpeed(next)
    try {
      localStorage.setItem(READING_SPEED_KEY, next)
      setPreferenceMessage('')
    } catch {
      setPreferenceMessage('速さを端末に保存できませんでした。この画面では選んだ速さで再生します。')
    }
    if (activeTarget.current) start(activeTarget.current, next)
  }

  return { supported, speed, active, message, preferenceMessage, explanation, toggle, changeSpeed, stop }
}
