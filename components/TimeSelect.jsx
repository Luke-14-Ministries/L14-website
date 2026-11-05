// A time of day, chosen rather than typed (Ellen, 5 Nov 2026). Her Safari 26
// showed "04:30 PM" in a native time box while reporting it unfinished and
// reading it as empty, after a refresh too; Chrome reads "02:00 --" (no AM/PM
// yet) as empty. Two lists -- the hour with its AM/PM, then the minutes in
// fives -- cannot be half-filled in any browser. Picking the hour alone gives
// the hour on the dot. Value and onChange are "HH:MM" (24-hour), '' for none.
// Used for activity slot times and Setup's registration opens/closes.
const HOURS = Array.from({ length: 24 }, (_, h) => [
  String(h).padStart(2, '0'),
  `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`,
]);
// Fives, plus :59 for "closes at 11:59 PM".
const MINUTES = [...Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')), '59'];

export default function TimeSelect({ value, onChange, label, className = '' }) {
  const [h, m] = value ? value.split(':') : ['', ''];
  // A time saved before these lists (9:07) keeps its own minute on the list.
  const minutes = m && !MINUTES.includes(m) ? [...MINUTES, m].sort() : MINUTES;
  return (
    <span className="flex gap-1">
      <select
        aria-label={`${label}: hour`}
        className={`${className} min-w-0 flex-1`}
        value={h}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')}
      >
        <option value="">Hour</option>
        {HOURS.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label}: minutes`}
        className={`${className} min-w-0 w-auto!`}
        value={m || '00'}
        disabled={!h}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
      >
        {minutes.map((v) => (
          <option key={v} value={v}>
            :{v}
          </option>
        ))}
      </select>
    </span>
  );
}
