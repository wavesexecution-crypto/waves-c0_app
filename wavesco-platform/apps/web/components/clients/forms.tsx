"use client";

import { useActionState } from "react";
import {
  createClientAction,
  toggleOnboardingStepAction,
  createProjectAction,
  createTaskAction,
  updateTaskStatusAction,
  createDeliverableAction,
  setDeliverableStatusAction,
  type ActionState,
} from "@/lib/actions/clients";

const initial: ActionState = { ok: false };

export function ClientCreateForm() {
  const [state, formAction, pending] = useActionState(createClientAction, initial);
  return (
    <form action={formAction} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs text-muted-foreground">
        Client name *
        <input name="name" required minLength={2} maxLength={120} className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-muted-foreground">
        Company
        <input name="company" maxLength={120} className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-muted-foreground">
        Email
        <input name="email" type="email" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-muted-foreground">
        Phone
        <input name="phone" maxLength={30} className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-muted-foreground sm:col-span-1 lg:col-span-2">
        Notes
        <input name="notes" maxLength={2000} className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {pending ? "Adding…" : "Add client"}
        </button>
        {state.error ? <span className="text-xs text-red-500">{state.error}</span> : null}
        {state.ok ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Client added.</span> : null}
      </div>
    </form>
  );
}

export function OnboardingToggle({ stepId, done }: { stepId: string; done: boolean }) {
  const [, formAction, pending] = useActionState(toggleOnboardingStepAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="stepId" value={stepId} />
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        title={done ? "Mark not done" : "Mark done"}
        className={`flex h-5 w-5 items-center justify-center rounded border text-[11px] ${done ? "border-emerald-500 bg-emerald-500 text-white" : "hover:bg-accent"} disabled:opacity-50`}
      >
        {done ? "✓" : ""}
      </button>
    </form>
  );
}

export function ProjectForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState(createProjectAction, initial);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input name="name" required minLength={2} maxLength={120} placeholder="Project name" className="w-48 rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      <input name="description" maxLength={2000} placeholder="Description (optional)" className="w-64 rounded-md border bg-transparent px-2 py-1.5 text-sm" />
      <button type="submit" disabled={pending} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
        {pending ? "…" : "+ Project"}
      </button>
      {state.error ? <span className="text-xs text-red-500">{state.error}</span> : null}
    </form>
  );
}

const TASK_STATES = ["todo", "in_progress", "blocked", "done"] as const;

export function TaskForm({ projectId, clientId }: { projectId: string; clientId: string }) {
  const [state, formAction, pending] = useActionState(createTaskAction, initial);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input name="title" required minLength={2} maxLength={160} placeholder="New task…" className="w-56 rounded-md border bg-transparent px-2 py-1 text-xs" />
      <select name="priority" defaultValue="medium" className="rounded-md border bg-transparent px-1.5 py-1 text-xs">
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      <button type="submit" disabled={pending} className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
        {pending ? "…" : "+ Task"}
      </button>
      {state.error ? <span className="text-xs text-red-500">{state.error}</span> : null}
    </form>
  );
}

export function TaskStatusSelect({
  taskId,
  status,
  clientId,
}: {
  taskId: string;
  status: string;
  clientId: string;
}) {
  const [, formAction, pending] = useActionState(updateTaskStatusAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="clientId" value={clientId} />
      <select
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={(e) => {
          e.currentTarget.form?.requestSubmit();
        }}
        className="rounded-md border bg-transparent px-1.5 py-0.5 text-[11px]"
      >
        {TASK_STATES.map((s) => (
          <option key={s} value={s}>{s.replace("_", " ")}</option>
        ))}
      </select>
    </form>
  );
}

export function DeliverableForm({ projectId, clientId }: { projectId: string; clientId: string }) {
  const [state, formAction, pending] = useActionState(createDeliverableAction, initial);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input name="title" required minLength={2} maxLength={160} placeholder="New deliverable…" className="w-56 rounded-md border bg-transparent px-2 py-1 text-xs" />
      <input name="type" maxLength={60} placeholder="type (e.g. website)" className="w-36 rounded-md border bg-transparent px-2 py-1 text-xs" />
      <button type="submit" disabled={pending} className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
        {pending ? "…" : "+ Deliverable"}
      </button>
      {state.error ? <span className="text-xs text-red-500">{state.error}</span> : null}
    </form>
  );
}

const DELIVERABLE_STATES = ["draft", "review", "delivered", "approved"] as const;

export function DeliverableStatusSelect({
  deliverableId,
  status,
  clientId,
}: {
  deliverableId: string;
  status: string;
  clientId: string;
}) {
  const [, formAction, pending] = useActionState(setDeliverableStatusAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="deliverableId" value={deliverableId} />
      <input type="hidden" name="clientId" value={clientId} />
      <select
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={(e) => {
          e.currentTarget.form?.requestSubmit();
        }}
        className="rounded-md border bg-transparent px-1.5 py-0.5 text-[11px]"
      >
        {DELIVERABLE_STATES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </form>
  );
}
