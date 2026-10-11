export function phoneNumber() {
  return {};
}

export function bearer() {
  return { id: "bearer" };
}

// config/auth.ts imports and calls emailOTP({...}) and magicLink({...}) at
// module load. Without these exports they resolve to undefined and throw
// "<plugin> is not a function", taking down every suite that imports the app.
export function emailOTP() {
  return { id: "email-otp" };
}

export function magicLink() {
  return {};
}
