'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface IdentityContacts {
  emails: { value: string; label: string; isPrimary?: boolean }[];
  phones: { value: string; label: string; isPrimary?: boolean }[];
  addresses: { street: string; city: string; state?: string; postalCode: string; country: string; label: string }[];
  virtualAddresses?: { value: string; label: string; isPrimary?: boolean }[];
  social?: { platform: string; value: string; label?: string }[];
}

interface IdentityPreferences {
  language: string;
  dateFormat: string;
  communicationStyle: 'formal' | 'casual' | 'professional';
  responseLength: 'concise' | 'detailed' | 'balanced';
  custom: Record<string, unknown>;
}

interface Identity {
  id: string;
  name: string;
  isDefault: boolean;
  displayName: string | null;
  title: string | null;
  company: string | null;
  bio: string | null;
  timezone: string;
  locale: string;
  contacts: IdentityContacts | null;
  preferences: IdentityPreferences | null;
  context: string | null;
  isActive: boolean;
}

interface IdentityEditDialogProps {
  identity: Identity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (identityId: string, data: Partial<Identity>) => Promise<void>;
}

export function IdentityEditDialog({
  identity,
  open,
  onOpenChange,
  onSave,
}: IdentityEditDialogProps) {
  // Basic info
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [bio, setBio] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [locale, setLocale] = useState('en-US');
  const [isActive, setIsActive] = useState(true);

  // Preferences
  const [language, setLanguage] = useState('en');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [communicationStyle, setCommunicationStyle] = useState<'formal' | 'casual' | 'professional'>('professional');
  const [responseLength, setResponseLength] = useState<'concise' | 'detailed' | 'balanced'>('balanced');

  // Contacts
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [addressPostalCode, setAddressPostalCode] = useState('');
  const [addressCountry, setAddressCountry] = useState('');
  const [addressLabel, setAddressLabel] = useState('Primary');
  const [virtualAddress, setVirtualAddress] = useState('');
  const [extraAddresses, setExtraAddresses] = useState<IdentityContacts['addresses']>([]);
  const [extraVirtualAddresses, setExtraVirtualAddresses] = useState<NonNullable<IdentityContacts['virtualAddresses']>>([]);

  // Context
  const [context, setContext] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset form when identity changes
  useEffect(() => {
    if (identity) {
      setName(identity.name);
      setDisplayName(identity.displayName || '');
      setTitle(identity.title || '');
      setCompany(identity.company || '');
      setBio(identity.bio || '');
      setTimezone(identity.timezone || 'UTC');
      setLocale(identity.locale || 'en-US');
      setIsActive(identity.isActive);
      setContext(identity.context || '');

      // Preferences
      setLanguage(identity.preferences?.language || 'en');
      setDateFormat(identity.preferences?.dateFormat || 'YYYY-MM-DD');
      setCommunicationStyle(identity.preferences?.communicationStyle || 'professional');
      setResponseLength(identity.preferences?.responseLength || 'balanced');

      // Contacts
      const primaryEmailEntry = identity.contacts?.emails?.find(e => e.isPrimary) || identity.contacts?.emails?.[0];
      const primaryPhoneEntry = identity.contacts?.phones?.find(p => p.isPrimary) || identity.contacts?.phones?.[0];
      setPrimaryEmail(primaryEmailEntry?.value || '');
      setPrimaryPhone(primaryPhoneEntry?.value || '');

      const addresses = identity.contacts?.addresses || [];
      const primaryAddress = addresses[0];
      setAddressStreet(primaryAddress?.street || '');
      setAddressCity(primaryAddress?.city || '');
      setAddressState(primaryAddress?.state || '');
      setAddressPostalCode(primaryAddress?.postalCode || '');
      setAddressCountry(primaryAddress?.country || '');
      setAddressLabel(primaryAddress?.label || 'Primary');
      setExtraAddresses(addresses.slice(1));

      const virtuals = identity.contacts?.virtualAddresses || [];
      let primaryVirtualIndex = 0;
      const primaryIndexFromFlag = virtuals.findIndex((v) => v.isPrimary);
      if (primaryIndexFromFlag >= 0) primaryVirtualIndex = primaryIndexFromFlag;
      const primaryVirtual = virtuals[primaryVirtualIndex];
      setVirtualAddress(primaryVirtual?.value || '');
      setExtraVirtualAddresses(virtuals.filter((_, idx) => idx !== primaryVirtualIndex));

      setError('');
    }
  }, [identity]);

  const handleSave = async () => {
    if (!identity) return;
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const addressFields = [addressStreet, addressCity, addressPostalCode, addressCountry];
    const hasAnyAddressField = addressFields.some((field) => field.trim().length > 0);
    const hasFullAddress = addressFields.every((field) => field.trim().length > 0);

    if (hasAnyAddressField && !hasFullAddress) {
      setError('Address requires street, city, postal code, and country.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const addresses = hasFullAddress
        ? [
            {
              street: addressStreet.trim(),
              city: addressCity.trim(),
              state: addressState.trim() || undefined,
              postalCode: addressPostalCode.trim(),
              country: addressCountry.trim(),
              label: addressLabel.trim() || 'Primary',
            },
            ...extraAddresses,
          ]
        : extraAddresses;

      const virtualAddresses = virtualAddress.trim()
        ? [
            { value: virtualAddress.trim(), label: 'Primary', isPrimary: true },
            ...extraVirtualAddresses,
          ]
        : extraVirtualAddresses;

      const contacts: IdentityContacts = {
        emails: primaryEmail ? [{ value: primaryEmail, label: 'Primary', isPrimary: true }] : [],
        phones: primaryPhone ? [{ value: primaryPhone, label: 'Primary', isPrimary: true }] : [],
        addresses,
        virtualAddresses,
        social: identity.contacts?.social || [],
      };

      const preferences: IdentityPreferences = {
        language,
        dateFormat,
        communicationStyle,
        responseLength,
        custom: identity.preferences?.custom || {},
      };

      const data: Partial<Identity> = {
        name: name.trim(),
        displayName: displayName.trim() || null,
        title: title.trim() || null,
        company: company.trim() || null,
        bio: bio.trim() || null,
        timezone,
        locale,
        contacts,
        preferences,
        context: context.trim() || null,
        isActive,
      };

      await onSave(identity.id, data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save identity');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Identity</DialogTitle>
          <DialogDescription>
            Configure the identity settings below.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="context">Context</TabsTrigger>
          </TabsList>

          <div className="py-4">
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive mb-4">
                {error}
              </div>
            )}

            <TabsContent value="basic" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  placeholder="Work, Personal..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-displayName">Display Name</Label>
                <Input
                  id="edit-displayName"
                  placeholder="How you want to be addressed"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-title">Role</Label>
                  <Input
                    id="edit-title"
                    placeholder="Role or title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-company">Company</Label>
                  <Input
                    id="edit-company"
                    placeholder="Acme Corp"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-bio">Bio</Label>
                <Textarea
                  id="edit-bio"
                  placeholder="A brief description..."
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">Eastern Time</SelectItem>
                      <SelectItem value="America/Chicago">Central Time</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                      <SelectItem value="Europe/London">London</SelectItem>
                      <SelectItem value="Europe/Paris">Paris</SelectItem>
                      <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                      <SelectItem value="Asia/Shanghai">Shanghai</SelectItem>
                      <SelectItem value="Australia/Sydney">Sydney</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Locale</Label>
                  <Select value={locale} onValueChange={setLocale}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-US">English (US)</SelectItem>
                      <SelectItem value="en-GB">English (UK)</SelectItem>
                      <SelectItem value="fr-FR">French</SelectItem>
                      <SelectItem value="de-DE">German</SelectItem>
                      <SelectItem value="es-ES">Spanish</SelectItem>
                      <SelectItem value="pt-BR">Portuguese (Brazil)</SelectItem>
                      <SelectItem value="ja-JP">Japanese</SelectItem>
                      <SelectItem value="zh-CN">Chinese (Simplified)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="space-y-0.5">
                  <Label htmlFor="edit-active">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    {isActive ? 'Identity is active and available' : 'Identity is inactive'}
                  </p>
                </div>
                <Switch
                  id="edit-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>
            </TabsContent>

            <TabsContent value="preferences" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label>Communication Style</Label>
                <Select value={communicationStyle} onValueChange={(v) => setCommunicationStyle(v as typeof communicationStyle)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional - Business-appropriate tone</SelectItem>
                    <SelectItem value="formal">Formal - Highly structured and respectful</SelectItem>
                    <SelectItem value="casual">Casual - Friendly and conversational</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Response Length</Label>
                <Select value={responseLength} onValueChange={(v) => setResponseLength(v as typeof responseLength)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="concise">Concise - Brief and to the point</SelectItem>
                    <SelectItem value="balanced">Balanced - Moderate detail</SelectItem>
                    <SelectItem value="detailed">Detailed - Comprehensive explanations</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="pt">Portuguese</SelectItem>
                    <SelectItem value="ja">Japanese</SelectItem>
                    <SelectItem value="zh">Chinese</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Date Format</Label>
                <Select value={dateFormat} onValueChange={setDateFormat}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (2024-01-15)</SelectItem>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (01/15/2024)</SelectItem>
                    <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (15/01/2024)</SelectItem>
                    <SelectItem value="DD.MM.YYYY">DD.MM.YYYY (15.01.2024)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Primary Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  placeholder="email@example.com"
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Used when the assistant needs to reference your email
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-phone">Primary Phone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={primaryPhone}
                  onChange={(e) => setPrimaryPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Physical Address</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Input
                      placeholder="Street address"
                      value={addressStreet}
                      onChange={(e) => setAddressStreet(e.target.value)}
                    />
                  </div>
                  <Input
                    placeholder="City"
                    value={addressCity}
                    onChange={(e) => setAddressCity(e.target.value)}
                  />
                  <Input
                    placeholder="State/Region"
                    value={addressState}
                    onChange={(e) => setAddressState(e.target.value)}
                  />
                  <Input
                    placeholder="Postal code"
                    value={addressPostalCode}
                    onChange={(e) => setAddressPostalCode(e.target.value)}
                  />
                  <Input
                    placeholder="Country"
                    value={addressCountry}
                    onChange={(e) => setAddressCountry(e.target.value)}
                  />
                  <div className="col-span-2">
                    <Input
                      placeholder="Label (optional)"
                      value={addressLabel}
                      onChange={(e) => setAddressLabel(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-virtual-address">Virtual Address</Label>
                <Input
                  id="edit-virtual-address"
                  placeholder="Handle, URL, or DID"
                  value={virtualAddress}
                  onChange={(e) => setVirtualAddress(e.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="context" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label htmlFor="edit-context">Additional Context</Label>
                <Textarea
                  id="edit-context"
                  placeholder="Add any additional information or notes that the assistant should know about this identity..."
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={8}
                />
                <p className="text-xs text-muted-foreground">
                  This context will be included in conversations when using this identity.
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
