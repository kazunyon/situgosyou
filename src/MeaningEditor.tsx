import { useEffect, useRef, useState } from 'react'
import { Mic, Search, Square, Volume2 } from 'lucide-react'
import { lookupMeaning, type MeaningResult } from './meaningLookup'
import { useReadAloud } from './useReadAloud'
import './meaning.css'

type Props = {
  title: string
  value: string
  onChange: (value: string) => void
  onApply: (value: string) => void
  onDictate: () => void
}

export function MeaningEditor({ title, value, onChange, onApply, onDictate }: Props) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<MeaningResult | null>(null)
  const request = useRef<AbortController | null>(null)
  const speech = useReadAloud(title, value)

  useEffect(() => {
    // Editing the input cancels the old request; closing the editor also aborts it.
    if (request.current) {
      request.current.abort()
      request.current = null
      setLoading(false)
      setMessage('入力が変わったため、取得を中止しました。')
    }
    return () => { request.current?.abort() }
  }, [title, value])

  const lookup = async () => {
    if (request.current) return
    if (!title.trim()) { setMessage('先にタイトルを書いてください。'); return }
    if (value.trim() && !window.confirm('入力済みの「意味・説明」を、ネットから取得した説明に置き換えますか？')) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setMessage('説明を調べています…')
    setResult(null)
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 15000)
    try {
      const found = await lookupMeaning(title, controller.signal)
      if (controller.signal.aborted || request.current !== controller) return
      request.current = null
      setLoading(false)
      onApply(found.text)
      setResult(found)
      setMessage('説明を入力しました。内容を確認して「保存」を押してください。')
    } catch (error) {
      if (request.current !== controller) return
      if (timedOut) setMessage('取得に時間がかかっています。通信を確認して、もう一度お試しください。')
      else if (!controller.signal.aborted) setMessage(error instanceof TypeError
        ? '通信できませんでした。インターネット接続を確認してください。'
        : error instanceof Error ? error.message : '説明を取得できませんでした。')
    } finally {
      window.clearTimeout(timer)
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }

  return <section className="meaning-section" aria-label="意味・説明の入力">
    <div className="speech-title-action">
      <button type="button" className="speech-button" onClick={() => speech.toggle('title')} disabled={!speech.supported || !title.trim()} aria-pressed={speech.active === 'title'}>
        {speech.active === 'title' ? <Square size={20} fill="currentColor" aria-hidden="true" /> : <Volume2 size={22} aria-hidden="true" />}
        {speech.active === 'title' ? '止める' : 'ことばを聞く'}
      </button>
    </div>
    <div className="meaning-actions">
      <button type="button" className="dictation" onClick={() => { speech.stop(); onDictate() }}><Mic size={23} aria-hidden="true" />話してタイトルを書く</button>
      <button type="button" className="meaning-button" onClick={() => void lookup()} disabled={loading} aria-describedby="meaning-help" aria-controls="memo-meaning">
        <Search size={22} aria-hidden="true" />{loading ? '取得中…' : '意味・説明'}
      </button>
    </div>
    <p id="meaning-help" className="meaning-help">タイトルのことばをWikipediaで調べ、約500文字の説明を入力します。</p>
    <label className="visually-hidden" htmlFor="memo-meaning">意味・説明</label>
    <textarea id="memo-meaning" value={value} onChange={(event) => onChange(event.target.value)} placeholder="説明を直接書くこともできます" rows={6} maxLength={2000} />
    <div className="speech-explanation-action">
      <button type="button" className="speech-button" onClick={() => speech.toggle('meaning')} disabled={!speech.supported || !speech.explanation} aria-pressed={speech.active === 'meaning'}>
        {speech.active === 'meaning' ? <Square size={20} fill="currentColor" aria-hidden="true" /> : <Volume2 size={22} aria-hidden="true" />}
        {speech.active === 'meaning' ? '止める' : '説明を聞く'}
      </button>
    </div>
    <fieldset className="speech-speed" disabled={!speech.supported}>
      <legend>読む速さ</legend>
      <button type="button" onClick={() => speech.changeSpeed('normal')} aria-pressed={speech.speed === 'normal'}>ふつう</button>
      <button type="button" onClick={() => speech.changeSpeed('slow')} aria-pressed={speech.speed === 'slow'}>ゆっくり</button>
    </fieldset>
    {!speech.supported && <p className="meaning-help">このブラウザでは読み上げを利用できません。</p>}
    <p className="meaning-message" role="status" aria-live="polite">{speech.message || speech.preferenceMessage}</p>
    <p className="meaning-message" role="status" aria-live="polite">{message}</p>
    {result && <a className="meaning-source" href={result.sourceUrl} target="_blank" rel="noopener noreferrer">出典：Wikipedia「{result.sourceTitle}」</a>}
  </section>
}
