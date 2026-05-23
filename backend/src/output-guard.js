const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
];

const ABUSIVE_TERMS = new Set([
  'explicit',
  'gore',
  'hate symbol',
  'nude',
  'porn',
  'slur',
  'terror',
]);

export function looksSensitive(value) {
  if (typeof value !== 'string') return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function scrubDescriptors(descriptors) {
  const json = JSON.stringify(descriptors);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(json))) {
    throw new Error('Refusing to return descriptors that contain key-shaped strings.');
  }

  return {
    locationType: coerceShortString(descriptors.locationType, 'locationType', 80),
    lightingConditions: coerceShortString(descriptors.lightingConditions, 'lightingConditions', 80),
    colorPalette: coerceShortString(descriptors.colorPalette, 'colorPalette', 80),
    mood: coerceShortString(descriptors.mood, 'mood', 80),
    framing: coerceShortString(descriptors.framing, 'framing', 80),
    architectureStyle:
      descriptors.architectureStyle === null || descriptors.architectureStyle === undefined
        ? null
        : coerceShortString(descriptors.architectureStyle, 'architectureStyle', 80),
    searchTerms: coerceSearchTerms(descriptors.searchTerms),
  };
}

function coerceShortString(value, field, maxLength) {
  if (typeof value !== 'string') {
    throw new Error(`Descriptor field ${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Descriptor field ${field} must not be empty.`);
  }
  return trimmed.slice(0, maxLength);
}

function coerceSearchTerms(value) {
  if (!Array.isArray(value)) {
    throw new Error('Descriptor field searchTerms must be an array.');
  }

  const terms = value
    .filter((term) => typeof term === 'string')
    .map((term) => term.trim().slice(0, 60))
    .filter(Boolean)
    .filter((term) => !containsAbusiveTerm(term));

  if (terms.length === 0) {
    throw new Error('Descriptor field searchTerms must include at least one searchable term.');
  }

  return terms.slice(0, 6);
}

function containsAbusiveTerm(value) {
  const lower = value.toLowerCase();
  return Array.from(ABUSIVE_TERMS).some((term) => lower.includes(term));
}
