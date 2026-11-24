// Camp Celebrate's highlight videos, one line per video, newest first
// (23 Nov 2026, review A4-13). Camp Celebrate shows the newest year's videos
// and Camp Memories lists them all; the pair used to be typed into both
// pages, so a new summer meant two edits that could disagree.
//
// After each camp, add the new year's lines at the top. `week` is left out
// for a year with one video. 2014 is on Vimeo, not YouTube; next.config.mjs's
// frame-src lists player.vimeo.com for it.
export const CAMP_VIDEOS = [
  { year: 2026, week: 1, youtube: 'uU4mb2_N4YA' },
  { year: 2026, week: 2, youtube: '93X7D2tUgiA' },
  { year: 2025, week: 1, youtube: 'K50SZpcMr08' },
  { year: 2025, week: 2, youtube: 'R6-cMWllAHs' },
  { year: 2024, youtube: 'Z1TrxIL0Ew4' },
  { year: 2023, youtube: 'v1h2fB7TdXg' },
  { year: 2022, youtube: 'Wqz00asfUf8' }, // re-uploaded to the ministry channel (@luke14ministries), 7 Nov 2026
  { year: 2021, youtube: 'hUrnuHMkmIQ' },
  { year: 2019, youtube: 'HO9SmcHJlZU' },
  { year: 2018, youtube: 'MeNiytYb3gI' },
  { year: 2017, youtube: 'j4N1BRNzLVU' },
  { year: 2016, youtube: 'szH9i3RILJk' },
  { year: 2015, youtube: 'XrqYe-0KchQ' },
  { year: 2014, vimeo: '116121002' },
  { year: 2013, youtube: 'U51mWei6bwo' },
];

// "2026 Week 1", or "2024" for a year with one video.
export const videoLabel = (v) => (v.week ? `${v.year} Week ${v.week}` : String(v.year));

// The newest year's videos, for Camp Celebrate's highlights.
export function latestCampVideos() {
  const year = Math.max(...CAMP_VIDEOS.map((v) => v.year));
  return { year, videos: CAMP_VIDEOS.filter((v) => v.year === year) };
}
