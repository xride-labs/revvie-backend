/**
 * APITxT SMS / OTP Gateway Service
 * Documentation: https://apitxt.com/developer
 * Endpoint: https://apitxt.com/api/sendOTP
 */

export interface SendApitxtOtpParams {
  mobile: string;
  otp: string;
  country?: string;
  channel?: "sms" | "whatsapp";
}

export interface ApitxtResponse {
  success: boolean;
  message: string;
  data?: any;
}

/**
 * Normalizes phone numbers to standard numeric format without leading '+'
 * e.g., "+91 98765 43210" -> "919876543210"
 * If a 10-digit number without country code is provided, defaults to country code 91.
 */
export function normalizePhoneNumber(phone: string, defaultCountry = "91"): string {
  // Remove all non-digits
  let digits = phone.replace(/\D/g, "");

  // If 10 digits (common for Indian mobile numbers without country code), prepend default country code
  if (digits.length === 10) {
    digits = `${defaultCountry}${digits}`;
  }

  return digits;
}

/**
 * Sends a 6-digit OTP via APITxT API.
 */
export async function sendApitxtOtp(params: SendApitxtOtpParams): Promise<ApitxtResponse> {
  const authKey = process.env.APITXT_AUTH_KEY?.trim();
  const baseUrl = process.env.APITXT_BASE_URL?.trim() || "https://apitxt.com/api";
  const defaultCountry = process.env.APITXT_DEFAULT_COUNTRY?.trim() || "91";

  const normalizedMobile = normalizePhoneNumber(params.mobile, params.country || defaultCountry);

  const isPlaceholderKey =
    !authKey ||
    authKey === "your-apitxt-authkey" ||
    authKey === "your_apitxt_auth_key_here" ||
    authKey.startsWith("your_") ||
    authKey.startsWith("your-");

  // In development/test, or if no valid API key is provided, log to console for dev/test convenience
  if (isPlaceholderKey || process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    console.log(`\n==============================================`);
    console.log(`[DEV/TEST SMS OTP - APITxT]`);
    console.log(`Recipient Mobile: ${normalizedMobile} (raw: ${params.mobile})`);
    console.log(`Verification OTP: ${params.otp}`);
    console.log(`AuthKey Configured: ${!isPlaceholderKey ? "YES" : "NO (Mock fallback)"}`);
    console.log(`==============================================\n`);

    // In development or test mode, simulate the OTP to server console (unless SEND_REAL_SMS=true)
    if (isPlaceholderKey || process.env.NODE_ENV === "test" || (process.env.NODE_ENV === "development" && process.env.SEND_REAL_SMS !== "true")) {
      return {
        success: true,
        message: "Development/Test mode: OTP simulated and logged to server console.",
      };
    }
  }

  try {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/sendOTP`);
    url.searchParams.set("authkey", authKey);
    url.searchParams.set("mobile", normalizedMobile);
    url.searchParams.set("otp", params.otp);
    url.searchParams.set("channel", params.channel || "sms");
    if (params.country) {
      url.searchParams.set("country", params.country);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    // APITxT returns various structures like { type: "success", message: "..." } or { status: "ok" }
    const isSuccess =
      response.ok &&
      (data?.type === "success" ||
        data?.status === "ok" ||
        data?.status === "success" ||
        data?.success === true ||
        (typeof text === "string" && text.toLowerCase().includes("success")));

    if (!isSuccess) {
      const errorMessage =
        data?.message || data?.error || `APITxT request failed with status ${response.status}`;
      console.warn(`[APITxT] Failed to send OTP to ${normalizedMobile}:`, errorMessage, data);
      return {
        success: false,
        message: errorMessage,
        data,
      };
    }

    return {
      success: true,
      message: data?.message || "OTP sent successfully via SMS",
      data,
    };
  } catch (error: any) {
    console.error(`[APITxT] Error sending OTP to ${normalizedMobile}:`, error);
    // If in development mode, don't block the user if network request fails
    if (process.env.NODE_ENV === "development") {
      console.warn("[APITxT] Network call failed in development; continuing with dev OTP fallback.");
      return {
        success: true,
        message: "Development fallback: OTP available in server console.",
      };
    }
    return {
      success: false,
      message: error.name === "AbortError" ? "SMS gateway timeout" : error.message || "Failed to deliver SMS",
    };
  }
}
