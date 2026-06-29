/**
 * M10: The Pomodoro guide — content model and terminal renderer.
 *
 * `GUIDE` is the single source of truth for the guide's content: a frozen,
 * plain-data structure that both the terminal renderer (here) and the HTML
 * renderer (render/guide-html.js) fold over, so the two surfaces can never
 * disagree (the same principle that keeps the stats panel and dashboard in
 * sync). Content is data, not markup; each renderer decides presentation.
 *
 * Section schema (every field optional except heading; rendered in this order):
 *   { heading, body: string[], steps: string[], bullets: string[],
 *     examples: {cmd, desc}[], cases: {when, fix}[], body2: string[] }
 * `body2` is trailing prose shown after the examples/cases of a section.
 *
 * House rule: no em-dashes anywhere in the content (commas, colons, parens).
 */
import { bold, dim, tomato, cyan } from './output.js';

export const GUIDE_SCHEMA = 1;

export const GUIDE = Object.freeze({
  schema: GUIDE_SCHEMA,
  title: 'The Pomodoro Technique with Claudoro',
  intro:
    'A practical guide to focusing in fixed intervals, and how Claudoro runs the method for you without leaving the terminal.',
  sections: [
    {
      heading: 'What it is',
      body: [
        'The Pomodoro Technique is a time-management method created by Francesco Cirillo in the late 1980s, when he was a university student in Rome who could not focus. He bet himself he could concentrate for just ten minutes and grabbed a tomato-shaped kitchen timer to prove it. Pomodoro is Italian for tomato, and each focused interval still carries the name.',
        'The idea is deliberately small: work in fixed, uninterrupted intervals separated by real breaks. One pomodoro is 25 minutes of single-tasking, then a 5-minute break. After four, you take a longer break of 15 to 30 minutes. The timer turns a vague intention to focus into a concrete, finishing-soon commitment, and the breaks keep your attention fresh instead of grinding it down.',
        'It fits Claude Code unusually well. Long sessions with an AI pair blur time: you lose track of how long you have been heads-down, and there is no natural seam to rest. Claudoro puts the countdown in the status line you are already watching, so the structure costs you no extra glance and no context switch.',
      ],
    },
    {
      heading: 'How a cycle works',
      body: [
        'The original method is six steps. Claudoro runs the timing for you, so in practice you only decide and work:',
      ],
      steps: [
        'Pick one task. Just one. Name it so it is concrete.',
        'Start a 25-minute pomodoro and work only on that task.',
        'When the alarm rings, stop. Even mid-sentence: the interval is the unit, not the task.',
        'Take a 5-minute break. Stand up, look away from the screen, let your attention reset.',
        'Repeat. After four pomodoros, take a longer break of 15 to 30 minutes.',
        'Start the next set refreshed.',
      ],
      bullets: [
        '25 / 5 / 15 every four is the classic cadence and Claudoro\'s default. The numbers are a starting point, not scripture: tune them once you know your own attention span (see "Tuning the cadence").',
      ],
    },
    {
      heading: 'Your first cycle',
      body: ['Two commands get you the whole loop. In a Claude Code session:'],
      examples: [
        {
          cmd: '/pomo start -t "wire up auth #project-x"',
          desc: 'begin a 25-minute focus block, labelled and tagged',
        },
        {
          cmd: '/pomo status',
          desc: "check elapsed time, label, today's count, and when the next long break lands",
        },
        {
          cmd: '/pomo skip',
          desc: 'finished early? bank this block and start the break now',
        },
      ],
      body2: [
        'In auto mode (the default) the boundaries take care of themselves: the break starts when focus ends, the next focus starts when the break ends, and the alarm tells you each time. Prefer the zero-token path? Run the CLI straight from the prompt with a leading bang: !pomo start 25 "wire up auth".',
      ],
    },
    {
      heading: 'The rules that make it work',
      body: [
        "Three of Cirillo's principles do the real work. They are worth keeping even when the tool makes them easy to skip:",
      ],
      bullets: [
        'A pomodoro is indivisible. There is no half a pomodoro. If you break concentration to check Slack, that pomodoro is void, not paused-and-resumed. The indivisibility is what trains the focus.',
        'Protect the break. The break is not optional slack to be skipped when busy; it is the part that keeps the next pomodoro sharp. Step away from the screen for it.',
        'The next one always starts fresh. A ruined or abandoned pomodoro is not a debt. You do not make it up. You simply start the next one clean.',
      ],
    },
    {
      heading: 'Handling interruptions',
      body: [
        "Interruptions are the technique's central problem, and Cirillo's answer is a script: inform, negotiate, schedule, call back. Tell the person you are mid-focus, agree a time, write down what they need, and get back to them when the pomodoro ends. The aim is to protect the current interval, not to be unreachable.",
        'Internal interruptions (a sudden idea, an unrelated bug you spot) get the same treatment: capture it and keep going rather than chasing it now.',
      ],
      examples: [
        {
          cmd: '/pomo note "ask Dana about the staging DB #followup"',
          desc: "capture an interruption onto the current block's label without breaking focus",
        },
        {
          cmd: '/pomo pause',
          desc: 'a genuine, unavoidable interruption you will return from (a call): freeze the countdown',
        },
        { cmd: '/pomo resume', desc: 'pick the same block back up where it froze' },
        {
          cmd: '/pomo stop',
          desc: 'the interruption ends the session: the current block is discarded, not counted',
        },
      ],
      body2: [
        'A strict reading of the method would void a paused pomodoro rather than freeze it. Claudoro offers pause as a pragmatic middle path, but if you are counting strictly, treat a real interruption as a stop and start fresh afterwards.',
      ],
    },
    {
      heading: 'Edge cases, and how Claudoro handles them',
      cases: [
        {
          when: 'You got pulled into a meeting and forgot the timer was running.',
          fix: 'Claudoro credits focus only up to your planned time plus a 30-minute overtime cap, then flags the block "abandoned" so a forgotten timer never inflates your stats. The true span is still recorded; pomo log shows both.',
        },
        {
          when: 'You finished the task with ten minutes left on the clock.',
          fix: "Run /pomo skip to bank the block and start the break now. Cirillo's advice for leftover time: review or polish what you just did, but do not start something new in the remaining minutes.",
        },
        {
          when: 'You are deep in flow and a break would break it.',
          fix: 'Use /pomo extend 10 to add minutes, or switch to manual mode so boundaries wait for you instead of auto-advancing. Flow is valuable; the technique serves it, not the reverse.',
        },
        {
          when: 'You stepped away and a break or boundary ran long.',
          fix: 'In balanced or manual mode a boundary left waiting past the overtime cap auto-closes to idle rather than counting up forever, so you return to a clean slate instead of a runaway clock.',
        },
        {
          when: 'You advanced a phase by mistake.',
          fix: 'Run /pomo back within a short window to undo the last transition, or /pomo undo N to remove recorded blocks (a backup is written first, and /pomo restore reverses it).',
        },
        {
          when: 'You have several Claude Code windows open.',
          fix: 'There is one global timer shown in every session, and exactly one alarm fires no matter how many are watching. Control it from any window. Hide the segment in a given pane with export CLAUDORO_HIDE=1.',
        },
      ],
    },
    {
      heading: 'Tuning the cadence',
      body: [
        'The defaults suit many people; your attention span is your own. All four durations are per-run flags, fixed for the life of a session:',
      ],
      examples: [
        {
          cmd: 'pomo start 50 -s 10 -l 30 -f 3',
          desc: '50/10/30 with a long break every 3: fewer, longer deep-work blocks',
        },
        {
          cmd: 'pomo start -w 15 -s 3',
          desc: 'shorter intervals when focus is hard to find or the work is fiddly',
        },
        {
          cmd: 'pomo mode balanced',
          desc: 'auto-start breaks but wait before the next focus (never waste focus while away)',
        },
        {
          cmd: 'pomo mode manual',
          desc: 'wait at every boundary: maximum control for deep-flow work',
        },
      ],
      body2: [
        'Rule of thumb: if you routinely hit the alarm still deeply focused, lengthen the block; if you drift before it rings, shorten it. Adjust one number at a time.',
      ],
    },
    {
      heading: 'Track and reflect',
      body: [
        'The point of recording pomodoros is not the count; it is noticing your own patterns. Claudoro derives every figure from an immutable log, so the history is always honest.',
      ],
      examples: [
        { cmd: 'pomo log', desc: "today's completed blocks, with labels and outcomes" },
        {
          cmd: 'pomo stats',
          desc: 'streak, focus heatmap, top tags, and your focus-by-hour, in the terminal',
        },
        {
          cmd: 'pomo stats --web',
          desc: 'the same analytics as a self-contained HTML dashboard in your browser',
        },
      ],
      body2: [
        'Tag your blocks (#project-x, #review) when you start them and stats will group your focus by project automatically. Over a week or two the heatmap and by-hour view show you when you actually focus best.',
      ],
    },
  ],
  references: [
    {
      text: 'Francesco Cirillo, The Pomodoro Technique (Currency / Penguin Random House, 2018; first self-published 2006)',
      url: 'https://www.penguinrandomhouse.com/books/555557/the-pomodoro-technique-by-francesco-cirillo/',
    },
    {
      text: 'The Pomodoro Technique, the official website',
      url: 'https://www.pomodorotechnique.com/',
    },
    {
      text: 'Pomodoro Technique, Wikipedia (overview and history)',
      url: 'https://en.wikipedia.org/wiki/Pomodoro_Technique',
    },
  ],
});

// ---------------------------------------------------------------------------
// Terminal renderer
// ---------------------------------------------------------------------------

/** Greedy word-wrap to `width` columns. Operates on plain text (no ANSI). */
const wrapText = (text, width) => {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
};

/**
 * Render the guide as a TTY-aware terminal panel. Colour gates on colorMode()
 * via the imported helpers, so piped/`NO_COLOR` output is clean plain text.
 * @param {typeof GUIDE} [g]
 * @param {{ columns?: number }} [opts] - terminal width (defaults to stdout)
 * @returns {string}
 */
export const renderGuide = (g = GUIDE, opts = {}) => {
  const cols = opts.columns ?? process.stdout.columns ?? 80;
  const width = Math.max(40, Math.min(cols, 88));
  const indent = '  ';
  const textWidth = width - indent.length;
  const out = [];

  out.push(bold(tomato('Claudoro')) + dim(' Pomodoro guide'));
  out.push('');
  for (const l of wrapText(g.intro, textWidth)) out.push(indent + dim(l));

  for (const s of g.sections) {
    out.push('');
    out.push(bold(tomato(s.heading)));

    const paras = (arr) => {
      for (const p of arr ?? []) {
        out.push('');
        for (const l of wrapText(p, textWidth)) out.push(indent + l);
      }
    };

    paras(s.body);

    (s.steps ?? []).forEach((step, i) => {
      const marker = `${i + 1}. `;
      const cont = ' '.repeat(marker.length);
      wrapText(step, textWidth - marker.length).forEach((l, j) => {
        out.push(indent + (j === 0 ? dim(marker) : cont) + l);
      });
    });

    for (const b of s.bullets ?? []) {
      wrapText(b, textWidth - 2).forEach((l, j) => {
        out.push(indent + (j === 0 ? tomato('• ') : '  ') + l);
      });
    }

    for (const ex of s.examples ?? []) {
      out.push('');
      out.push(indent + cyan(ex.cmd));
      for (const l of wrapText(ex.desc, textWidth - 2)) out.push(indent + '  ' + dim(l));
    }

    for (const c of s.cases ?? []) {
      out.push('');
      for (const l of wrapText(c.when, textWidth)) out.push(indent + bold(l));
      for (const l of wrapText(c.fix, textWidth - 2)) out.push(indent + '  ' + dim(l));
    }

    paras(s.body2);
  }

  out.push('');
  out.push(bold(tomato('References')));
  for (const r of g.references) {
    out.push('');
    for (const l of wrapText(r.text, textWidth)) out.push(indent + l);
    out.push(indent + dim(r.url));
  }

  return out.join('\n');
};
