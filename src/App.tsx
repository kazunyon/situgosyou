import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, Edit3, LogIn, Mic, Plus, Search, Settings, Star, Trash2, X } from 'lucide-react'
import { isCloudConfigured, supabase } from './supabase'
import { loadMemos, removeMemo, saveMemo } from './storage'
import type { Filter, Memo } from './types'

const emptyDraft = (): Memo => ({ id: crypto.randomUUID(), title: '', meaning: '', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })

type SpeechWindow = Window & typeof globalThis & { webkitSpeechRecognition?: new () => SpeechRecognition }

function App() {
  const [memos, setMemos] = useState<Memo[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Memo | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [authEmail, setAuthEmail] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [sentToEmail, setSentToEmail] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setLoading(true)
    try { setMemos(await loadMemos()) } catch (error) { const message = error instanceof Error ? error.message : (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string' ? error.message : String(error)); setNotice('読み込みに失敗しました：' + message) } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!supabase) return
    let mounted = true
    void supabase.auth.getSession().then(({ data }) => { if (mounted) setCurrentUserEmail(data.session?.user.email ?? null) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserEmail(session?.user.email ?? null)
      if (session) void refresh()
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])
  useEffect(() => { if (draft) setTimeout(() => titleRef.current?.focus(), 100) }, [draft])

  const displayed = useMemo(() => memos.filter((memo) => !memo.deleted && (filter === 'all' || memo.marked) && `${memo.title} ${memo.meaning}`.toLowerCase().includes(query.toLowerCase())), [filter, memos, query])

  const openNew = () => setDraft(emptyDraft())
  const openEdit = (memo: Memo) => setDraft({ ...memo })
  const persist = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft?.title.trim()) { setNotice('タイトルを書いてください。'); return }
    const item = { ...draft, title: draft.title.trim(), meaning: draft.meaning.trim(), updatedAt: new Date().toISOString() }
    try {
      await saveMemo(item)
      setMemos((current) => [item, ...current.filter((memo) => memo.id !== item.id)])
      setDraft(null)
      setNotice('保存しました')
    } catch { setNotice('保存に失敗しました。通信を確認してください。') }
  }
  const toggleMark = async (memo: Memo) => {
    const next = { ...memo, marked: !memo.marked, updatedAt: new Date().toISOString() }
    await saveMemo(next)
    setMemos((current) => current.map((item) => item.id === next.id ? next : item))
  }
  const erase = async (memo: Memo) => {
    if (!confirm(`「${memo.title}」を削除しますか？`)) return
    await removeMemo(memo)
    setMemos((current) => current.filter((item) => item.id !== memo.id))
    setNotice('削除しました')
  }
  const dictate = () => {
    const Recognition = window.SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition
    if (!Recognition) { setNotice('このブラウザでは音声入力に対応していません。'); return }
    const recognition = new Recognition()
    recognition.lang = 'ja-JP'
    recognition.interimResults = false
    recognition.onresult = (event) => setDraft((current) => current ? { ...current, title: `${current.title}${current.title ? ' ' : ''}${event.results[0][0].transcript}` } : current)
    recognition.onerror = () => setNotice('音声を聞き取れませんでした。もう一度試してください。')
    recognition.start()
  }
  const sendMagicLink = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setSigningIn(true)
    const { error } = await supabase.auth.signInWithOtp({ email: authEmail, options: { emailRedirectTo: window.location.origin } })
    setSigningIn(false)
    if (error) { setNotice(`ログインメールを送れませんでした：${error.message}`); return }
    setSentToEmail(authEmail)
    setNotice('確認メールを送りました。メール内のリンクを開いてください。')
  }
  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setCurrentUserEmail(null)
    setSentToEmail(null)
    setAuthEmail('')
    setMemos([])
    setNotice('ログアウトしました。別の人のメールアドレスでログインできます。')
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">こ</span><h1>ことばメモ</h1></div><button className="icon-button" aria-label="設定"><Settings size={25} /></button></header>
    <section className="intro"><h2>思い出したいことを、すぐに。</h2><p>ことばでも、文章でも書けます。</p></section>
    <label className="search-box"><Search size={24} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="さがす" aria-label="メモをさがす" /></label>
    <section className="actions"><button className="primary-button" onClick={openNew}><Plus size={28} /> 新しく書く</button><button className="voice-button" onClick={() => { openNew(); setTimeout(dictate, 120) }}><Mic size={25} /> 話して書く</button></section>
    <nav className="filter-tabs" aria-label="表示するメモ"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>すべて</button><button className={filter === 'marked' ? 'selected' : ''} onClick={() => setFilter('marked')}><Star size={18} fill={filter === 'marked' ? 'currentColor' : 'none'} /> マーク</button></nav>
    <section className="memo-list" aria-live="polite">
      {loading ? <p className="status">読み込み中…</p> : displayed.length === 0 ? <p className="status">まだメモがありません。<br />「新しく書く」から追加できます。</p> : displayed.map((memo) => <article className="memo-row" key={memo.id}>
        <button className={`star-button ${memo.marked ? 'marked' : ''}`} onClick={() => void toggleMark(memo)} aria-label={memo.marked ? 'マークを外す' : 'マークする'}><Star fill={memo.marked ? 'currentColor' : 'none'} /></button>
        <button className="memo-content" onClick={() => openEdit(memo)}><strong>{memo.title}</strong>{memo.meaning && <span>{memo.meaning}</span>}</button>
        <button className="icon-button edit" onClick={() => openEdit(memo)} aria-label="編集"><Edit3 size={22} /></button>
      </article>)}
    </section>
    {!isCloudConfigured && <section className="local-note"><strong>いまはこの端末だけの試作モードです</strong><span>同期を有効にするには、Supabaseの設定を追加します。</span></section>}
    {isCloudConfigured && (currentUserEmail ? <section className="sync-box sync-status"><Check size={22} /><div><strong>{currentUserEmail} で同期中</strong><span>この人のメモだけを表示しています。</span></div><button type="button" onClick={() => void signOut()}>別の人でログイン</button></section> : sentToEmail ? <section className="sync-box sync-status"><Check size={22} /><div><strong>確認メールを送信しました</strong><span><b>{sentToEmail}</b> のメール内にあるリンクを開いてください。ここで同じメールアドレスを入力し直す必要はありません。</span></div></section> : <form className="sync-box" onSubmit={sendMagicLink}><LogIn size={22} /><div><strong>PCとスマホで同期</strong><span>同じメールアドレスでログインします</span></div><input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="メールアドレス" required /><button disabled={signingIn}>{signingIn ? '送信中' : 'ログイン'}</button></form>)}
    <nav className="bottom-nav"><button className="active"><Search size={21} />すべて</button><button onClick={() => setFilter('marked')}><Star size={21} />マーク</button><button><Settings size={21} />設定</button></nav>
    {notice && <div className="toast"><Check size={20} />{notice}<button onClick={() => setNotice('')} aria-label="閉じる"><X size={18} /></button></div>}
    {draft && <div className="modal-backdrop" role="presentation"><form className="editor" onSubmit={persist}><header><button type="button" className="icon-button" onClick={() => setDraft(null)} aria-label="戻る"><ChevronLeft /></button><h2>{memos.some((memo) => memo.id === draft.id) ? 'メモを直す' : '新しく書く'}</h2><button className="save-button" type="submit">保存</button></header><label>タイトル<input ref={titleRef} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例：田中さん" /></label><button type="button" className="dictation" onClick={dictate}><Mic size={23} /> 話してタイトルを書く</button><label>意味・説明<textarea value={draft.meaning} onChange={(event) => setDraft({ ...draft, meaning: event.target.value })} placeholder="思い出すための説明を書きます" rows={4} /></label><label className="mark-toggle"><input type="checkbox" checked={draft.marked} onChange={(event) => setDraft({ ...draft, marked: event.target.checked })} /><Star fill={draft.marked ? 'currentColor' : 'none'} /> 大事なメモとしてマークする</label>{memos.some((memo) => memo.id === draft.id) && <button type="button" className="delete-button" onClick={() => { void erase(draft); setDraft(null) }}><Trash2 size={21} /> このメモを削除</button>}</form></div>}
  </main>
}

export default App
