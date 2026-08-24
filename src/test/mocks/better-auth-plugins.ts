export function phoneNumber() {
  return {};
}

export function bearer() {
  return {};
}

// config/auth.ts imports and calls emailOTP({...}) and magicLink({...}) at
// module load. Without these exports they resolve to undefined and throw
// "<plugin> is not a function", taking down every suite that imports the app.
export function emailOTP() {
  return {};
}

export function magicLink() {
  return {};
}
