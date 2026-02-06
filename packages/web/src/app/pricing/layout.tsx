import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Choose the perfect plan for your AI assistant needs. From free tier to enterprise solutions with unlimited assistants and messages.',
  openGraph: {
    title: 'Pricing | Assistants',
    description: 'Choose the perfect plan for your AI assistant needs. From free tier to enterprise solutions with unlimited assistants and messages.',
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
