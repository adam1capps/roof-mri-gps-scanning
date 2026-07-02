/**
 * Voice reading entry: the contractor says "<command> <number>" — e.g.
 * "mark seven" — and the reading is recorded at the current position.
 *
 * The parser is deliberately forgiving about speech-to-text quirks: it scans
 * the transcript for the LAST command+number pair, accepts digits or number
 * words, and tolerates filler between recognitions ("uh mark it's a mark 7").
 */

export const DEFAULT_COMMAND_WORDS = ['mark', 'reading', 'record'];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  won: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
};

export interface VoiceCommand {
  value: number;
  commandWord: string;
}

function wordToValue(token: string): number | null {
  const clean = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^\d{1,2}$/.test(clean)) {
    const n = parseInt(clean, 10);
    return n >= 0 && n <= 10 ? n : null;
  }
  return clean in NUMBER_WORDS ? NUMBER_WORDS[clean] : null;
}

/**
 * Extracts the last "<command> <number>" in a transcript, or null.
 * `commandWords` are matched case-insensitively as whole words.
 */
export function parseVoiceCommand(
  transcript: string,
  commandWords: string[] = DEFAULT_COMMAND_WORDS,
): VoiceCommand | null {
  const tokens = transcript.split(/\s+/).filter(Boolean);
  const commands = new Set(commandWords.map(w => w.toLowerCase().trim()).filter(Boolean));

  let result: VoiceCommand | null = null;
  for (let i = 0; i < tokens.length - 1; i++) {
    const word = tokens[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!commands.has(word)) continue;
    const value = wordToValue(tokens[i + 1]);
    if (value !== null) {
      result = { value, commandWord: word };
    }
  }
  return result;
}
