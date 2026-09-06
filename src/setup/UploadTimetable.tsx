import { useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { isAcceptedFile } from '../lib/parse/extractText'
import { IconUpload } from '../components/icons'

interface Props {
  onFile: (file: File) => void
}

export function UploadTimetable({ onFile }: Props) {
  const parseError = useApp((s) => s.parseError)
  const enterManualEntry = useApp((s) => s.enterManualEntry)
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  function handle(file: File | undefined) {
    if (!file) return
    if (!isAcceptedFile(file)) {
      setLocalErr('That file type isn’t supported. Use a PDF, JPG, PNG or WEBP.')
      return
    }
    setLocalErr(null)
    onFile(file)
  }

  return (
    <div className="setup-card">
      <div className="setup-kicker">Setup · Step 1 of 3</div>
      <h1 className="setup-h">
        Let’s set up
        <br />
        your timetable
      </h1>
      <p className="setup-p">Upload your college timetable and we’ll turn it into a schedule you can tap.</p>

      <div
        className={`drop${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          handle(e.dataTransfer.files?.[0])
        }}
      >
        <div className="up-ico">
          <IconUpload />
        </div>
        <div className="up-main">Drop your timetable here</div>
        <div className="up-or">or</div>
        <button
          type="button"
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation()
            inputRef.current?.click()
          }}
        >
          Choose file
        </button>
        <div className="up-formats">PDF · JPG · JPEG · PNG · WEBP</div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
          hidden
          onChange={(e) => handle(e.target.files?.[0] ?? undefined)}
        />
      </div>

      {/* A PDF carries its own text, so we read the characters instead of
          recognising pixels — exact, and far faster. Worth saying plainly:
          most people have both and would otherwise screenshot out of habit. */}
      <p className="up-tip">
        <span aria-hidden="true">💡</span>
        <span>
          <b>A PDF works best.</b> We can read its text directly, so subjects and rooms come through
          exactly. Screenshots have to be recognised letter by letter, and small type often needs
          fixing afterwards.
        </span>
      </p>

      {(localErr || parseError) && (
        <div className="banner" role="alert">
          {localErr || parseError}
        </div>
      )}

      <div className="setup-actions">
        <button className="btn subtle" onClick={enterManualEntry}>
          Enter manually instead
        </button>
      </div>
    </div>
  )
}
