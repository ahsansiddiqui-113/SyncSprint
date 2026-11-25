import type { Metadata } from "next";
import { KeyRound, Lock, ScrollText, ShieldCheck, Sparkles, Users } from "lucide-react";
import { DocPage, DocSection } from "@/components/marketing/site-header";

export const metadata: Metadata = { title: "Security — SyncSprint", description: "How SyncSprint keeps your workspace data safe." };

const PILLARS = [
  { icon: Lock, title: "Isolated workspaces", body: "Every request is checked against your workspace membership before any data is read or written." },
  { icon: ShieldCheck, title: "Role-based access", body: "Owners, admins, members and viewers. Permissions are enforced on our servers, not just in the interface." },
  { icon: KeyRound, title: "Secure sign-in", body: "Passwords are stored as salted hashes, never in plain text. Sessions use secure, HTTP-only cookies." },
  { icon: ScrollText, title: "Activity history", body: "Changes to tasks, members and settings are recorded so you can see who changed what, and when." },
  { icon: Users, title: "Controlled invites", body: "Invite links work once, only for the invited email address, and expire after 7 days." },
  { icon: Sparkles, title: "Careful AI", body: "AI features only see the task content they need from your own workspace, and usage is limited per workspace." },
];

export default function SecurityPage() {
  return (
    <DocPage
      eyebrow="Security"
      title="Your work stays yours."
      intro="SyncSprint is built so that each workspace is completely separate from every other one, and every action is checked against what your role allows."
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((p) => (
          <div key={p.title} className="rounded-2xl border border-border bg-white p-7 shadow-card">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <p.icon className="h-5 w-5" />
            </span>
            <h2 className="mt-5 text-[19px] font-bold tracking-tight">{p.title}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-16">
        <DocSection title="Workspace isolation">
          <p>
            Every piece of workspace content — projects, tasks, comments, checklists, tags and activity — belongs to exactly one workspace.
            Before we return or change anything, we confirm you are a member of that workspace. Links or IDs that belong to another workspace
            behave as if they don&apos;t exist.
          </p>
        </DocSection>
        <DocSection title="Roles and permissions">
          <ul>
            <li><strong>Viewers</strong> can see boards, lists, calendars, timelines, dashboards and activity.</li>
            <li><strong>Members</strong> can also create, edit and move tasks, comment, and use the AI assistant.</li>
            <li><strong>Admins</strong> can also create projects, invite people and change roles.</li>
            <li><strong>Owners</strong> have full control. A workspace always keeps at least one owner.</li>
          </ul>
        </DocSection>
        <DocSection title="Real-time updates">
          <p>
            Live updates are delivered only to signed-in members of the same workspace. When someone is removed from a workspace,
            their live connection is closed immediately.
          </p>
        </DocSection>
        <DocSection title="Safe concurrent editing">
          <p>
            When two people change the same task at the same moment, SyncSprint keeps the first change and tells the second person
            exactly what changed — nothing is silently overwritten.
          </p>
        </DocSection>
        <DocSection title="AI features">
          <p>
            The AI assistant only receives the task text and project activity it needs to answer your request, and only from your own
            workspace. Text you write is always treated as data, never as instructions to the AI. Each workspace has a daily AI usage limit.
            If the AI is unavailable, you still get a basic suggestion.
          </p>
        </DocSection>
        <DocSection title="Reporting an issue">
          <p>If you believe you&apos;ve found a security issue, please contact the team that operates your SyncSprint instance.</p>
        </DocSection>
      </div>
    </DocPage>
  );
}
