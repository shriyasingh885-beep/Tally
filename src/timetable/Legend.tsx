export function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      <span className="k">
        <span className="swatch present" /> Present
      </span>
      <span className="k">
        <span className="swatch" /> Not marked / upcoming
      </span>
      <span className="k">
        <span className="swatch none" /> No class
      </span>
    </div>
  )
}
