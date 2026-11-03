export interface BusinessInfoData {
  clientId: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  website?: string;
  socialMedia?: Record<string, unknown>[];
  location?: Record<string, unknown>;
  workHours?: Record<string, unknown> | Record<string, unknown>[];
  paymentMethods?: string[];
  installmentOptions?: string[];
}
