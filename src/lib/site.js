// Your business contact details. Edit the values between the quote marks.
// Anything you leave empty ('') is simply not shown on the website, so it
// is safe to fill these in one at a time.
//
// phone:    the number customers can call, any normal format, e.g. '0712 345 678'
// whatsapp: only fill this in if your WhatsApp number is DIFFERENT from phone.
//           Leave '' to use the phone number for WhatsApp too.
// email:    shown on the Contact page and in the footer
// hours:    free text, e.g. 'Mon to Sat, 8am to 7pm'

export const SITE = {
  name: 'Kins Trendy Collections',
  phone: '0717 025 361',
  whatsapp: '',
  email: '',
  hours: '',
  serviceArea: 'Nairobi and delivery across Kenya',
};

// Turns 0712 345 678 or +254 712 345 678 into 254712345678
function toInternational(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  if (digits.length === 9) return '254' + digits;
  return digits;
}

const phoneIntl = toInternational(SITE.phone);
const whatsappIntl = toInternational(SITE.whatsapp) || phoneIntl;

export const hasPhone = Boolean(phoneIntl);
export const hasWhatsApp = Boolean(whatsappIntl);
export const phoneDisplay = SITE.phone.trim();
export const phoneTelHref = phoneIntl ? `tel:+${phoneIntl}` : '';
export const phoneE164 = phoneIntl ? `+${phoneIntl}` : '';

// Link that opens a WhatsApp chat, with a ready-typed first message.
export function whatsappLink(message = '') {
  if (!whatsappIntl) return '';
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${whatsappIntl}${text}`;
}

export const hasAnyContact = hasPhone || hasWhatsApp || Boolean(SITE.email.trim());
