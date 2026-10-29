"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@corely/ui";
import { CheckCircle2, Circle, Plus, Search, Trash2 } from "lucide-react";
import type { TodoDto } from "@corely/contracts";
import { completeTodo, deleteTodo, fetchTodos, reopenTodo } from "../todos-api";
import { PageHeader } from "@/components/dashboard/page-header";

const priorityStyles = {
  low: "bg-accent-muted text-accent border-transparent",
  medium: "bg-warning-muted text-amber-800 border-transparent",
  high: "bg-danger-muted text-danger border-transparent",
} as const;

type StatusFilter = "all" | "open" | "done";

export function TodosListPage() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const deferredSearch = useDeferredValue(search);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["todos", deferredSearch, status],
    queryFn: () =>
      fetchTodos({
        page: 1,
        pageSize: 100,
        q: deferredSearch.trim() || undefined,
        status: status === "all" ? undefined : status,
      }),
  });

  const completeMutation = useMutation({
    mutationFn: completeTodo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["todos"] });
      toast({ title: "Task completed" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: reopenTodo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["todos"] });
      toast({ title: "Task reopened" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTodo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["todos"] });
      toast({ title: "Task deleted", variant: "destructive" });
    },
  });

  const items = data?.items ?? [];
  const openCount = items.filter((todo) => todo.status === "open").length;
  const doneCount = items.filter((todo) => todo.status === "done").length;

  const toggleTodo = (todo: TodoDto) => {
    if (todo.status === "done") {
      reopenMutation.mutate(todo.id);
      return;
    }

    completeMutation.mutate(todo.id);
  };

  const removeTodo = (todo: TodoDto) => {
    if (!window.confirm(`Delete "${todo.title}"?`)) {
      return;
    }

    deleteMutation.mutate(todo.id);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        eyebrow="Your home · Task management"
        description="Keep track of what needs to be done, from setup to your next project."
        actions={
          <Button onClick={() => router.push("/todos/new")}>
            <Plus aria-hidden="true" className="h-4 w-4" /> Create task
          </Button>
        }
      />

      {isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-danger-muted p-4"
        >
          <p className="text-sm">Could not load tasks. Please try again.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      <section aria-label="Task summary" className="grid grid-cols-2 gap-4">
        <Card className="rounded-lg shadow-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Open
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <p className="text-3xl font-semibold">
                {isLoading || isError ? "—" : openCount}
              </p>
              <span className="rounded-lg bg-accent-muted p-2.5 text-primary">
                <Circle aria-hidden="true" className="h-5 w-5" />
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Done
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <p className="text-3xl font-semibold">
                {isLoading || isError ? "—" : doneCount}
              </p>
              <span className="rounded-lg bg-success-muted p-2.5 text-emerald-700">
                <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-lg shadow-surface">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search tasks"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks"
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(["all", "open", "done"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  aria-pressed={status === option}
                  variant={status === option ? "default" : "outline"}
                  onClick={() => setStatus(option)}
                  className="capitalize"
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((todo) => (
                <TableRow key={todo.id}>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleTodo(todo)}
                      disabled={
                        completeMutation.isPending || reopenMutation.isPending
                      }
                      aria-label={
                        todo.status === "done"
                          ? `Reopen ${todo.title}`
                          : `Mark ${todo.title} as complete`
                      }
                    >
                      {todo.status === "done" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Link
                        href={`/todos/${todo.id}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {todo.title}
                      </Link>
                      {todo.description ? (
                        <p className="line-clamp-1 text-sm text-muted-foreground">
                          {todo.description}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={priorityStyles[todo.priority]}
                    >
                      {todo.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {todo.dueDate
                      ? new Date(todo.dueDate).toLocaleDateString()
                      : "No deadline"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/todos/${todo.id}/edit`}>Edit</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTodo(todo)}
                        aria-label={`Delete ${todo.title}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    <span role="status">Loading tasks…</span>
                  </TableCell>
                </TableRow>
              ) : null}
              {!items.length && !isLoading && !isError ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No tasks found. Create your first task.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
