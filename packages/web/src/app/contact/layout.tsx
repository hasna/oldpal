import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with our team. We\'re here to help with questions about our AI assistant platform, support requests, and partnership inquiries.',
  openGraph: {
    title: 'Contact | Assistants',
    description: 'Get in touch with our team. We\'re here to help with questions about our AI assistant platform, support requests, and partnership inquiries.',
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
