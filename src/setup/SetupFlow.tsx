import { useCallback, useRef } from 'react'
import { useApp } from '../store/appStore'
import { extractTimetable } from '../lib/parse/extractTimetable'
import { pdfPages } from '../lib/parse/extractText'
import { PickPage } from './PickPage'
import { UploadTimetable } from './UploadTimetable'
import { ParsingState } from './ParsingState'
import { TimetableReview } from './TimetableReview'
import { SetupComplete } from './SetupComplete'

// Hard failures — the file couldn't be read at all. Bounce back to upload.
const FAIL_MESSAGES: Record<string, string> = {
  empty: 'That file looked empty. Try a clearer scan, or add your classes by hand.',
  decode: 'Couldn’t open that file. Try another one.',
}

// Soft failures — we read text but couldn't build a confident grid. Go straight
// to the review screen so the user can finish it instead of hitting a dead end.
const PARTIAL_NOTES: Record<string, string> = {
  'no-days':
    'We couldn’t read a clear day-by-day grid from that image (screenshots from timetable software often don’t OCR well). Add your classes below — it’s quick.',
  'no-times':
    'We found the days but not the time slots. Fill in the times and any missing classes below.',
  'no-cells':
    'We picked up the grid but couldn’t read the class details. Add them below.',
  messy:
    'Some classes came through, but this layout (parallel lab batches, merged cells) is hard to read automatically. Please check every row and add anything missing.',
  'time-gap':
    'Part of the day had no readable time row, so classes in it may be missing. Check the times below against your timetable.',
}

export function SetupFlow() {
  const stage = useApp((s) => s.setupStage)
  const startParsing = useApp((s) => s.startParsing)
  const setStepState = useApp((s) => s.setStepState)
  const parsingSucceeded = useApp((s) => s.parsingSucceeded)
  const parsingFailed = useApp((s) => s.parsingFailed)
  const setParseProgress = useApp((s) => s.setParseProgress)
  const offerPages = useApp((s) => s.offerPages)

  // Held so the picker can come back to the same file without a re-upload.
  const fileRef = useRef<File | null>(null)

  const runParse = useCallback(
    async (file: File, pageNumber = 1) => {
      fileRef.current = file
      startParsing()
      try {
        // Steps light up from the real pipeline — each one is genuine work.
        const ORDER = ['read', 'days', 'slots', 'subjects', 'rooms', 'organize']
        let current = ''
        const result = await extractTimetable(
          file,
          (step, pct) => {
          if (step !== current) {
            const from = ORDER.indexOf(current)
            const to = ORDER.indexOf(step)
            for (let i = Math.max(0, from); i < to; i++) setStepState(ORDER[i], 'done')
            setStepState(step, 'active')
            current = step
          }
            if (pct != null && pct >= 100) setStepState(step, 'done')
            setParseProgress(pct ?? null)
          },
          pageNumber,
        )
        for (const key of ORDER) setStepState(key, 'done')
        setParseProgress(null)

        if (!result.ok) {
          parsingFailed(FAIL_MESSAGES[result.reason ?? 'empty'] ?? FAIL_MESSAGES.empty)
          return
        }
        if (result.partial) {
          const key = result.reason ?? (result.classes.length ? 'messy' : 'no-cells')
          parsingSucceeded(result.classes, result.breaks, PARTIAL_NOTES[key] ?? PARTIAL_NOTES.messy)
          return
        }
        parsingSucceeded(result.classes, result.breaks)
      } catch (err) {
        const msg =
          err instanceof Error && err.message === 'image-decode'
            ? FAIL_MESSAGES.decode
            : 'Couldn’t read this timetable. Try another file, or add your classes by hand.'
        parsingFailed(msg)
        setParseProgress(null)
      }
    },
    [startParsing, setStepState, parsingSucceeded, parsingFailed, setParseProgress],
  )

  /**
   * One PDF often holds a timetable per branch. Read the page headings first —
   * they are in the text layer, so it costs nothing — and ask which one to
   * parse. A single-page file never sees the question.
   */
  const onFile = useCallback(
    async (file: File) => {
      fileRef.current = file
      try {
        const pages = await pdfPages(file)
        if (pages.length > 1) {
          offerPages(pages)
          return
        }
      } catch {
        // couldn't enumerate — fall through and read it as a single page
      }
      void runParse(file, 1)
    },
    [offerPages, runParse],
  )

  return (
    <div className="setup">
      {stage === 'upload' && <UploadTimetable onFile={onFile} />}
      {stage === 'pages' && (
        <PickPage onPick={(n) => fileRef.current && runParse(fileRef.current, n)} />
      )}
      {stage === 'parsing' && <ParsingState />}
      {stage === 'review' && <TimetableReview />}
      {stage === 'complete' && <SetupComplete />}
    </div>
  )
}
