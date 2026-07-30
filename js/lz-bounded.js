// Bounded variant of LZ-String 1.5.0 URI decompression. The project already
// ships LZ-String under its MIT license in vendor/lz-string.js; this small
// decoder adds an output ceiling so hostile, highly-compressible input cannot
// allocate an arbitrarily large string before share-schema validation runs.

const URI_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
const URI_VALUES = Object.freeze(Object.fromEntries([...URI_ALPHABET].map((char, index) => [char, index])));

/** Returns null for malformed input or when decompressed output crosses maxChars. */
export function decompressURIComponentBounded(input, maxChars) {
  if (input == null) return '';
  if (input === '') return null;
  if (typeof input !== 'string' || !Number.isSafeInteger(maxChars) || maxChars < 1) return null;
  const source = input.replace(/ /g, '+');
  const getNextValue = index => URI_VALUES[source.charAt(index)];
  const dictionary = [0, 1, 2];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = '';
  const result = [];
  let outputLength = 0;
  const data = { val: getNextValue(0), position: 32, index: 1 };

  const readBits = (width) => {
    let bits = 0, power = 1;
    const maxPower = 2 ** width;
    while (power !== maxPower) {
      if (!Number.isFinite(data.val)) return null;
      const bit = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = 32;
        data.val = getNextValue(data.index++);
      }
      if (bit > 0) bits += power;
      power *= 2;
    }
    return bits;
  };

  let next = readBits(2);
  if (next === null) return null;
  let charCode;
  if (next === 0) charCode = readBits(8);
  else if (next === 1) charCode = readBits(16);
  else if (next === 2) return '';
  else return null;
  if (charCode === null) return null;

  let c = String.fromCharCode(charCode);
  dictionary[3] = c;
  let w = c;
  result.push(c);
  outputLength = c.length;
  if (outputLength > maxChars) return null;

  while (true) {
    if (data.index > source.length) return null;
    const code = readBits(numBits);
    if (code === null) return null;
    let dictionaryIndex = code;
    if (dictionaryIndex === 0 || dictionaryIndex === 1) {
      charCode = readBits(dictionaryIndex === 0 ? 8 : 16);
      if (charCode === null) return null;
      dictionary[dictSize++] = String.fromCharCode(charCode);
      dictionaryIndex = dictSize - 1;
      enlargeIn--;
    } else if (dictionaryIndex === 2) {
      return result.join('');
    }

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }

    if (typeof dictionary[dictionaryIndex] === 'string') entry = dictionary[dictionaryIndex];
    else if (dictionaryIndex === dictSize) entry = w + w.charAt(0);
    else return null;

    if (outputLength + entry.length > maxChars) return null;
    outputLength += entry.length;
    result.push(entry);
    if (w.length + 1 > maxChars) return null;
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}
