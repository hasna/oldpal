export interface AssistantSettings {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPromptAddition?: string;
  enabledTools?: string[];
  disabledTools?: string[];
  skillDirectories?: string[];
}

export interface Assistant {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  defaultIdentityId?: string;
  settings: AssistantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ContactEntry {
  value: string;
  label: string;
  isPrimary?: boolean;
}

export interface AddressEntry {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  label: string;
}

export interface SocialEntry {
  platform: string;
  value: string;
  label?: string;
}

export interface IdentityProfile {
  displayName: string;
  title?: string;
  company?: string;
  bio?: string;
  timezone: string;
  locale: string;
}

export interface IdentityContacts {
  emails: ContactEntry[];
  phones: ContactEntry[];
  addresses: AddressEntry[];
  social?: SocialEntry[];
}

export interface IdentityPreferences {
  language: string;
  dateFormat: string;
  communicationStyle: 'formal' | 'casual' | 'professional';
  responseLength: 'concise' | 'detailed' | 'balanced';
  codeStyle?: {
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
  };
  custom: Record<string, unknown>;
}

export interface Identity {
  id: string;
  name: string;
  isDefault: boolean;
  profile: IdentityProfile;
  contacts: IdentityContacts;
  preferences: IdentityPreferences;
  context?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssistantOptions {
  name: string;
  description?: string;
  avatar?: string;
  settings?: Partial<AssistantSettings>;
}

export interface CreateIdentityOptions {
  name: string;
  profile?: Partial<IdentityProfile>;
  contacts?: Partial<IdentityContacts>;
  preferences?: Partial<IdentityPreferences>;
  context?: string;
}
