import type { Metadata } from "next";
import { DocPage, DocSection } from "@/components/marketing/site-header";

export const metadata: Metadata = { title: "Terms of Service — SyncSprint", description: "The terms that apply when you use SyncSprint." };

export default function TermsPage() {
  return (
    <DocPage
      eyebrow="Legal"
      title="Terms of Service"
      updated="November 26, 2026"
      intro="These terms apply when you create an account or use a SyncSprint workspace. By using SyncSprint, you agree to them."
    >
      <DocSection title="Your account">
        <p>
          You are responsible for keeping your sign-in details secure and for activity under your account. Please provide accurate
          information and keep it up to date.
        </p>
      </DocSection>
      <DocSection title="Workspaces and roles">
        <p>
          Workspace owners and admins decide who can join their workspace and what role each person has. Owners are responsible for
          the people they invite and for how their workspace is used.
        </p>
      </DocSection>
      <DocSection title="Your content">
        <p>
          You keep ownership of the content you create. You give SyncSprint permission to store, process and display it only as needed
          to provide the service to you and your workspace, including AI features you choose to use.
        </p>
      </DocSection>
      <DocSection title="Acceptable use">
        <ul>
          <li>Don&apos;t try to access workspaces or data you haven&apos;t been given access to.</li>
          <li>Don&apos;t disrupt the service, overload it, or attempt to bypass limits such as AI usage limits.</li>
          <li>Don&apos;t use SyncSprint for anything unlawful or to store content you don&apos;t have the right to share.</li>
        </ul>
      </DocSection>
      <DocSection title="AI features">
        <p>
          AI suggestions are generated automatically and may be inaccurate. Review them before relying on them. AI usage may be
          limited per workspace each day.
        </p>
      </DocSection>
      <DocSection title="Demo workspaces">
        <p>Demo workspaces are for trying the product. Their content is sample data and may be removed at any time.</p>
      </DocSection>
      <DocSection title="Availability and changes">
        <p>
          We work to keep SyncSprint available and reliable, but the service is provided &ldquo;as is&rdquo;. We may add, change or
          remove features over time, and we may update these terms — the date above shows the latest version.
        </p>
      </DocSection>
      <DocSection title="Ending your use">
        <p>
          You can stop using SyncSprint at any time. Access may be suspended for accounts that break these terms or put other users at risk.
        </p>
      </DocSection>
    </DocPage>
  );
}
