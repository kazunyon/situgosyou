import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, Edit3, LogIn, Mic, Plus, Search, Settings, Star, Trash2, Upload, X } from 'lucide-react'
import { DEFAULT_CATEGORIES, loadCategories, MAX_CATEGORIES, saveCategories } from './categories'
import { isCloudConfigured, supabase } from './supabase'
import { loadMemos, parseBackup, removeMemo, replaceMemos, saveMemo, serializeBackup } from './storage'
import type { CategoryNumber, Filter, Memo, MemoCategory } from './types'
import './settings.css'

const categoryName = (categories: MemoCategory[], number: CategoryNumber) => categories.find((category) => category.number === number)?.name ?? `カテゴリ${number}`
const emptyDraft = (displayNumber: number, categoryNumber: CategoryNumber): Memo => ({ id: crypto.randomUUID(), displayNumber, categoryNumber, title: '', meaning: '', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
const normalizeOtpCode = (value: string) => value
  .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
  .replace(/\D/g, '')
  .slice(0, 6)

type SpeechWindow = Window & typeof globalThis & { webkitSpeechRecognition?: new () => SpeechRecognition }

function App() {
  const [memos, setMemos] = useState<Memo[]>([])
  const [categories, setCategories] = useState<MemoCategory[]>(DEFAULT_CATEGORIES.map((item) => ({ ...item })))
  const [categoryDrafts, setCategoryDrafts] = useState<MemoCategory[]>(DEFAULT_CATEGORIES.map((item) => ({ ...item })))
  const [filter, setFilter] = useState<Filter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryNumber | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Memo | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [authEmail, setAuthEmail] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [sentToEmail, setSentToEmail] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [savingCategories, setSavingCategories] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const backupFileRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const [loadedMemos, loadedCategories] = await Promise.all([loadMemos(), loadCategories()])
      setMemos(loadedMemos)
      setCategories(loadedCategories)
      setCategoryDrafts(loadedCategories.map((item) => ({ ...item })))
    } catch (error) { const message = error instanceof Error ? error.message : (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string' ? error.message : String(error)); setNotice('読み込みに失敗しました：' + message) } finally { setLoading(false) }
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
  useEffect(() => { if (draft) setTimeout(() => titleRef.current?.focus(), 100) }, [draft?.id])
  useEffect(() => {
    if (categoryFilter !== null && !categories.some((category) => category.number === categoryFilter)) setCategoryFilter(null)
  }, [categories, categoryFilter])
  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setTimeout(() => setResendSeconds((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  const displayed = useMemo(() => memos
    .filter((memo) => {
      const matchesFilter = filter === 'all' || memo.marked
      const matchesCategory = categoryFilter === null || memo.categoryNumber === categoryFilter
      return !memo.deleted && matchesFilter && matchesCategory && `${memo.displayNumber} ${categoryName(categories, memo.categoryNumber)} ${memo.title} ${memo.meaning}`.toLowerCase().includes(query.toLowerCase())
    })
    .sort((a, b) => a.displayNumber - b.displayNumber || a.createdAt.localeCompare(b.createdAt)), [categories, categoryFilter, filter, memos, query])
  const backupUnavailable = isCloudConfigured && !currentUserEmail

  const openNew = () => {
    const nextNumber = memos.reduce((highest, memo) => !memo.deleted ? Math.max(highest, memo.displayNumber) : highest, 0) + 1
    setDraft(emptyDraft(nextNumber, categoryFilter ?? categories[0]?.number ?? 1))
  }
  const openSettings = () => {
    setCategoryDrafts(categories.map((item) => ({ ...item })))
    setSettingsOpen(true)
  }
  const addCategory = () => {
    if (categoryDrafts.length >= MAX_CATEGORIES) { setNotice(`カテゴリは最大${MAX_CATEGORIES}件です。`); return }
    const usedNumbers = new Set(categoryDrafts.map((item) => item.number))
    let nextNumber = 1
    while (usedNumbers.has(nextNumber)) nextNumber += 1
    setCategoryDrafts((current) => [...current, { number: nextNumber, name: '' }].sort((a, b) => a.number - b.number))
  }
  const removeCategoryDraft = (number: CategoryNumber) => {
    if (categoryDrafts.length <= 1) { setNotice('カテゴリは1件以上必要です。'); return }
    if (memos.some((memo) => !memo.deleted && memo.categoryNumber === number)) { setNotice(`カテゴリ${number}を使っているメモがあります。先にメモのカテゴリを変更してください。`); return }
    setCategoryDrafts((current) => current.filter((item) => item.number !== number))
  }
  const persistCategoryMaster = async () => {
    const normalized = categoryDrafts.map((item) => ({ ...item, name: item.name.trim() }))
    if (normalized.some((item) => !item.name)) { setNotice('すべてのカテゴリ名を入力してください。'); return }
    if (new Set(normalized.map((item) => item.name)).size !== normalized.length) { setNotice('同じカテゴリ名は登録できません。'); return }
    setSavingCategories(true)
    try {
      const saved = await saveCategories(normalized)
      setCategories(saved)
      setCategoryDrafts(saved.map((item) => ({ ...item })))
      setNotice('カテゴリを保存しました')
    } catch (error) {
      setNotice(`カテゴリを保存できませんでした：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSavingCategories(false)
    }
  }
  const openEdit = (memo: Memo) => setDraft({ ...memo })
  const persist = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft?.title.trim()) { setNotice('タイトルを書いてください。'); return }
    if (!Number.isInteger(draft.displayNumber) || draft.displayNumber < 1 || draft.displayNumber > 9999) { setNotice('表示番号は1から9999までの整数で入力してください。'); return }
    if (!categories.some((category) => category.number === draft.categoryNumber)) { setNotice('登録されているカテゴリを選んでください。'); return }
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
  const requestLoginCode = async (email: string, resent = false) => {
    if (!supabase) return
    setSigningIn(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true }
      })
      if (error) { setNotice(`確認コードを送信できませんでした：${error.message}`); return }
      setAuthEmail(email)
      setSentToEmail(email)
      setAuthCode('')
      setResendSeconds(60)
      setNotice(resent ? '新しい6桁の確認コードを送信しました。' : 'メールに6桁の確認コードを送信しました。')
    } catch (error) {
      setNotice(`確認コードを送信できませんでした。通信を確認してください：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSigningIn(false)
    }
  }
  const sendLoginCode = async (event: FormEvent) => {
    event.preventDefault()
    const email = authEmail.trim().toLowerCase()
    if (!email) { setNotice('メールアドレスを入力してください。'); return }
    await requestLoginCode(email)
  }
  const verifyLoginCode = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !sentToEmail) return
    if (!/^\d{6}$/.test(authCode)) { setNotice('メールに届いた6桁の確認コードを入力してください。'); return }
    setVerifyingCode(true)
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: sentToEmail,
        token: authCode,
        type: 'email'
      })
      if (error) {
        setNotice(`ログインできませんでした。コードが正しいか、有効期限内か確認してください：${error.message}`)
        return
      }
      setCurrentUserEmail(data.user?.email ?? sentToEmail)
      setSentToEmail(null)
      setAuthCode('')
      setResendSeconds(0)
      setNotice('ログインしました。メモを同期します。')
      await refresh()
    } catch (error) {
      setNotice(`ログインできませんでした。通信を確認して、もう一度お試しください：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setVerifyingCode(false)
    }
  }
  const resendLoginCode = async () => {
    if (!sentToEmail || resendSeconds > 0 || signingIn) return
    await requestLoginCode(sentToEmail, true)
  }
  const changeLoginEmail = () => {
    setSentToEmail(null)
    setAuthCode('')
    setResendSeconds(0)
    setNotice('メールアドレスを入力し直してください。')
  }
  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setCurrentUserEmail(null)
    setSentToEmail(null)
    setAuthEmail('')
    setAuthCode('')
    setResendSeconds(0)
    setMemos([])
    setCategories(DEFAULT_CATEGORIES.map((item) => ({ ...item })))
    setCategoryDrafts(DEFAULT_CATEGORIES.map((item) => ({ ...item })))
    setNotice('ログアウトしました。別の人のメールアドレスでログインできます。')
  }
  const downloadBackup = async () => {
    setBackingUp(true)
    try {
      const latestMemos = await loadMemos()
      setMemos(latestMemos)
      const blob = new Blob([serializeBackup(latestMemos)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const now = new Date()
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const link = document.createElement('a')
      link.href = url
      link.download = `ことばメモ_バックアップ_${date}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`${latestMemos.length}件のメモをバックアップしました`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(`バックアップに失敗しました：${message}`)
    } finally {
      setBackingUp(false)
    }
  }
  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setRestoring(true)
    try {
      const imported = parseBackup(await file.text())
      const confirmed = confirm(`バックアップには${imported.length}件のメモがあります。\n\n現在のメモをすべて置き換えて、バックアップを戻しますか？`)
      if (!confirmed) return
      const restored = await replaceMemos(imported)
      setMemos(restored)
      setFilter('all')
      setCategoryFilter(null)
      setQuery('')
      setSettingsOpen(false)
      setNotice(`${restored.length}件のメモを戻しました`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(`バックアップを戻せませんでした：${message}`)
    } finally {
      setRestoring(false)
    }
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">こ</span><h1>ことばメモ</h1></div><button type="button" className="icon-button" onClick={openSettings} aria-label="設定"><Settings size={25} /></button></header>
    <section className="intro"><h2>思い出したいことを、すぐに。</h2><p>ことばでも、文章でも書けます。</p></section>
    <label className="search-box"><Search size={24} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="さがす" aria-label="メモをさがす" /></label>
    <section className="actions"><button className="primary-button" onClick={openNew}><Plus size={28} /> 新しく書く</button><button className="voice-button" onClick={() => { openNew(); setTimeout(dictate, 120) }}><Mic size={25} /> 話して書く</button></section>
    <div className="filter-group"><span className="filter-group-label">大分類</span><nav className="filter-tabs" aria-label="全体の表示切り替え"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>すべて</button><button className={filter === 'marked' ? 'selected' : ''} onClick={() => setFilter('marked')}><Star size={18} fill={filter === 'marked' ? 'currentColor' : 'none'} /> マーク</button></nav></div>
    <div className="category-group"><span className="filter-group-label">カテゴリ</span><nav className="category-tabs" aria-label="カテゴリの切り替え">{categories.map((category) => <button key={category.number} className={categoryFilter === category.number ? 'selected' : ''} onClick={() => setCategoryFilter((current) => current === category.number ? null : category.number)} aria-pressed={categoryFilter === category.number} aria-label={`${category.number} ${category.name}`}><b>{category.number}</b>{category.name}</button>)}</nav><small>選択中のカテゴリをもう一度押すと、絞り込みを解除できます。</small></div>
    <section className="memo-list" aria-live="polite">
      {loading ? <p className="status">読み込み中…</p> : displayed.length === 0 ? <p className="status">まだメモがありません。<br />「新しく書く」から追加できます。</p> : displayed.map((memo) => <article className="memo-row" key={memo.id}>
        <button className={`star-button ${memo.marked ? 'marked' : ''}`} onClick={() => void toggleMark(memo)} aria-label={memo.marked ? 'マークを外す' : 'マークする'}><Star fill={memo.marked ? 'currentColor' : 'none'} /></button>
        <span className="memo-number" aria-label={`表示番号 ${memo.displayNumber}`}>{memo.displayNumber}.</span>
        <button className="memo-content" onClick={() => openEdit(memo)}><strong>{memo.title}</strong><span className="memo-category">{memo.categoryNumber} {categoryName(categories, memo.categoryNumber)}</span>{memo.meaning && <span>{memo.meaning}</span>}</button>
        <button className="icon-button edit" onClick={() => openEdit(memo)} aria-label="編集"><Edit3 size={22} /></button>
      </article>)}
    </section>
    {!isCloudConfigured && <section className="local-note"><strong>いまはこの端末だけの試作モードです</strong><span>同期を有効にするには、Supabaseの設定を追加します。</span></section>}
    {isCloudConfigured && (currentUserEmail ? <section className="sync-box sync-status"><Check size={22} /><div><strong>{currentUserEmail} で同期中</strong><span>この人のメモだけを表示しています。</span></div><button type="button" onClick={() => void signOut()}>別の人でログイン</button></section> : sentToEmail ? <form className="sync-box otp-box" onSubmit={verifyLoginCode}><Check size={22} /><div><strong>確認コードを入力</strong><span><b>{sentToEmail}</b> に届いた6桁の数字を入力してください。</span></div><label className="otp-label" htmlFor="login-code">6桁の確認コード</label><input id="login-code" className="otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" enterKeyHint="done" pattern="[0-9]{6}" value={authCode} onChange={(event) => setAuthCode(normalizeOtpCode(event.target.value))} placeholder="123456" autoFocus required /><p className="otp-help">メールのリンクは開かず、表示されている6桁の数字をこの画面へ入力します。</p><button className="otp-submit" disabled={verifyingCode || authCode.length !== 6}>{verifyingCode ? '確認中…' : 'コードを確認してログイン'}</button><div className="otp-actions"><button type="button" onClick={() => void resendLoginCode()} disabled={signingIn || resendSeconds > 0}>{signingIn ? '送信中…' : resendSeconds > 0 ? `再送まで ${resendSeconds}秒` : 'コードを再送する'}</button><button type="button" onClick={changeLoginEmail} disabled={signingIn || verifyingCode}>メールアドレスを変更</button></div></form> : <form className="sync-box" onSubmit={sendLoginCode}><LogIn size={22} /><div><strong>PCとスマホで同期</strong><span>メールに届く6桁のコードでログインします</span></div><input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" inputMode="email" placeholder="メールアドレス" required /><button disabled={signingIn}>{signingIn ? '送信中…' : '6桁のコードを送る'}</button></form>)}
    <nav className="bottom-nav"><button className={!settingsOpen && filter === 'all' ? 'active' : ''} onClick={() => { setSettingsOpen(false); setFilter('all') }}><Search size={21} />すべて</button><button className={!settingsOpen && filter === 'marked' ? 'active' : ''} onClick={() => { setSettingsOpen(false); setFilter('marked') }}><Star size={21} />マーク</button><button className={settingsOpen ? 'active' : ''} onClick={openSettings}><Settings size={21} />設定</button></nav>
    {notice && <div className="toast"><Check size={20} />{notice}<button onClick={() => setNotice('')} aria-label="閉じる"><X size={18} /></button></div>}
    {draft && <div className="modal-backdrop" role="presentation"><form className="editor" onSubmit={persist}><header><button type="button" className="icon-button" onClick={() => setDraft(null)} aria-label="戻る"><ChevronLeft /></button><h2>{memos.some((memo) => memo.id === draft.id) ? 'メモを直す' : '新しく書く'}</h2><button className="save-button" type="submit">保存</button></header><label>表示番号<input type="number" inputMode="numeric" min="1" max="9999" step="1" value={draft.displayNumber || ''} onChange={(event) => setDraft({ ...draft, displayNumber: event.target.value === '' ? 0 : event.target.valueAsNumber })} placeholder="例：1" /></label><p className="number-help">「すべて」の一覧に表示する番号です。</p><fieldset className="category-picker"><legend>カテゴリ</legend><div>{categories.map((category) => <button type="button" key={category.number} className={draft.categoryNumber === category.number ? 'selected' : ''} onClick={() => setDraft({ ...draft, categoryNumber: category.number })} aria-pressed={draft.categoryNumber === category.number} aria-label={`${category.number} ${category.name}`}><b>{category.number}</b>{category.name}</button>)}</div><p>表示番号とは別に管理され、あとから自由に変更できます。</p></fieldset><label>タイトル<input ref={titleRef} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例：田中さん" /></label><button type="button" className="dictation" onClick={dictate}><Mic size={23} /> 話してタイトルを書く</button><label>意味・説明<textarea value={draft.meaning} onChange={(event) => setDraft({ ...draft, meaning: event.target.value })} placeholder="思い出すための説明を書きます" rows={4} /></label><label className="mark-toggle"><input type="checkbox" checked={draft.marked} onChange={(event) => setDraft({ ...draft, marked: event.target.checked })} /><Star fill={draft.marked ? 'currentColor' : 'none'} /> 大事なメモとしてマークする</label>{memos.some((memo) => memo.id === draft.id) && <button type="button" className="delete-button" onClick={() => { void erase(draft); setDraft(null) }}><Trash2 size={21} /> このメモを削除</button>}</form></div>}
    {settingsOpen && <div className="modal-backdrop settings-backdrop"><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><button type="button" className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="戻る"><ChevronLeft /></button><h2 id="settings-title">設定</h2><span className="settings-header-spacer" /></header><section className="category-settings"><h3>カテゴリの管理</h3><p>名前の変更や追加ができます。カテゴリは最大{MAX_CATEGORIES}件です。</p><div className="category-master-list">{categoryDrafts.map((category) => <div className="category-master-row" key={category.number}><span>{category.number}</span><input value={category.name} onChange={(event) => setCategoryDrafts((current) => current.map((item) => item.number === category.number ? { ...item, name: event.target.value } : item))} maxLength={20} aria-label={`カテゴリ${category.number}の名前`} /><button type="button" onClick={() => removeCategoryDraft(category.number)} aria-label={`カテゴリ${category.number}を削除`} disabled={savingCategories}><Trash2 size={19} /></button></div>)}</div><div className="category-master-actions"><button type="button" className="category-add-button" onClick={addCategory} disabled={categoryDrafts.length >= MAX_CATEGORIES || savingCategories}><Plus size={19} />カテゴリを追加</button><button type="button" className="category-save-button" onClick={() => void persistCategoryMaster()} disabled={savingCategories}>{savingCategories ? '保存中…' : 'カテゴリを保存'}</button></div></section><div className="settings-intro backup-intro"><h3>データのバックアップ</h3><p>大切なメモをファイルに保存したり、保存したファイルから戻したりできます。</p></div><div className="settings-actions"><button type="button" className="settings-action" onClick={() => void downloadBackup()} disabled={backupUnavailable || backingUp || restoring}><span className="settings-action-icon"><Download size={25} /></span><span><strong>{backingUp ? 'バックアップ中…' : 'バックアップ'}</strong><small>{backupUnavailable ? 'ログイン後に利用できます' : 'すべてのメモをファイルに保存します'}</small></span><ChevronRight className="settings-action-arrow" size={22} /></button><button type="button" className="settings-action" onClick={() => backupFileRef.current?.click()} disabled={backupUnavailable || backingUp || restoring}><span className="settings-action-icon restore"><Upload size={25} /></span><span><strong>{restoring ? '戻しています…' : 'バックアップを戻す'}</strong><small>{backupUnavailable ? 'ログイン後に利用できます' : '現在のメモを、保存した内容に置き換えます'}</small></span><ChevronRight className="settings-action-arrow" size={22} /></button><input ref={backupFileRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={(event) => void restoreBackup(event)} /></div><p className="backup-note">{currentUserEmail ? `${currentUserEmail} で同期しているメモが対象です。` : isCloudConfigured ? 'ログインすると、同期しているメモをバックアップできます。' : 'この端末に保存されているメモが対象です。'}</p></section></div>}
  </main>
}

export default App
