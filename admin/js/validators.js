export const LIMITS = {
  projectName: 80,
  projectDescription: 240,
  projectType: 30,
  toolName: 40,
  serviceTitle: 60,
  serviceDescription: 300
};

const LOCAL_IMAGE = /^images\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:jpe?g|png|webp|svg)$/i;
const HASH_TARGET = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const isEmail = (value) => EMAIL.test(value);

export function isTarget(value) {
  if (HASH_TARGET.test(value) || isHttpUrl(value)) return true;
  return /^mailto:/i.test(value) && EMAIL.test(value.slice(7).split('?')[0]);
}

export const isImageRef = (value) => isHttpUrl(value) || LOCAL_IMAGE.test(value);

export const optionalUrl = (value) => (value && !isHttpUrl(value) ? 'Enter a full URL starting with http:// or https://.' : '');
export const targetRule = (value) => (value && !isTarget(value) ? 'Use a section like #projects, a full http(s) URL, or a mailto: link.' : '');
export const emailRule = (value) => (value && !isEmail(value) ? 'Enter a valid email address.' : '');
export const imageRule = (value) => (value && !isImageRef(value) ? 'Use a JPG, PNG, WebP or SVG inside images/, or an http(s) URL.' : '');
