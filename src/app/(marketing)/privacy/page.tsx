import type { Metadata } from "next";
import { DocPage, DocSection } from "@/components/marketing/site-header";

export const metadata: Metadata = { title: "Privacy Policy — SyncSprint", description: "What data SyncSprint collects and how it is used." };

export default function PrivacyPage() {
  return (
    <DocPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="November 26, 2026"
      intro="This policy explains what information SyncSprint collects, why, and the choices you have."
    >
      <DocSection title="Information we collect">
        <ul>
          <li><strong>Account information:</strong> your name, email address and a securely hashed password. If you sign in with Google, we receive your name, email and profile picture from Google.</li>
          <li><strong>Workspace content:</strong> the projects, tasks, comments, checklists, tags, dates and other content you and your teammates create.</li>
          <li><strong>Activity records:</strong> a history of changes made in your workspace (for example, who moved a task and when).</li>
          <li><strong>Technical information:</strong> the IP address and browser information associated with your sign-in session.</li>
        </ul>
      </DocSection>
      <DocSection title="How we use information">
        <ul>
          <li>To provide the service: show your workspaces, sync changes in real time and keep your activity history.</li>
          <li>To keep accounts secure: authenticate you and enforce workspace roles and permissions.</li>
          <li>To power AI features you choose to use, such as subtask suggestions and standup summaries.</li>
        </ul>
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </DocSection>
      <DocSection title="Cookies">
        <p>SyncSprint uses cookies only to keep you signed in. We do not use advertising or third-party tracking cookies.</p>
      </DocSection>
      <DocSection title="AI providers">
        <p>
          When you use an AI feature, the relevant task text and project activity from your workspace may be sent to an AI provider
          (such as OpenRouter, Google or Groq) to generate the result. Only the content needed for that request is sent.
        </p>
      </DocSection>
      <DocSection title="Who can see your data">
        <p>
          Content in a workspace is visible to members of that workspace, according to their role. Workspace owners and admins
          control who is invited and what role they have.
        </p>
      </DocSection>
      <DocSection title="Retention and deletion">
        <p>
          Workspace content is kept while the workspace exists. When a task is deleted, its comments, checklist, tags and links are
          deleted with it. When you leave a workspace or are removed, you lose access to its content.
        </p>
      </DocSection>
      <DocSection title="Your choices">
        <ul>
          <li>You can update or delete the content you create at any time.</li>
          <li>You can leave any workspace from its Members page.</li>
          <li>To request access to or deletion of your account data, contact the operator of your SyncSprint instance.</li>
        </ul>
      </DocSection>
      <DocSection title="Changes to this policy">
        <p>If we make material changes, we will update the date at the top of this page.</p>
      </DocSection>
    </DocPage>
  );
}
