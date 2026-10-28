import type { Project } from '@forge/shared';
import Link from 'next/link';
import { workspaceHref } from '@/lib/nav';

/** Projects with how many tickets are still open and how many there are in all. */
export function ProjectsTable({ slug, projects }: { slug: string; projects: Project[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-edge bg-panel">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Projects in this workspace</caption>
        <thead>
          <tr className="border-b border-edge text-xs text-muted">
            <th scope="col" className="px-4 py-2 font-medium">
              Project
            </th>
            <th scope="col" className="w-20 px-4 py-2 text-right font-medium">
              Open
            </th>
            <th scope="col" className="w-20 px-4 py-2 text-right font-medium">
              All
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {projects.map((project) => (
            <tr key={project.id} className="hover:bg-raised/50">
              <th scope="row" className="px-4 py-3 font-normal">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-6 min-w-10 shrink-0 items-center justify-center rounded border border-edge-strong bg-raised px-1.5 font-mono text-xs font-medium">
                    {project.key}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={workspaceHref(slug, `/projects/${project.key}`)}
                      className="font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.archived && (
                      <span className="ml-2 rounded border border-edge-strong px-1.5 py-0.5 text-[11px] text-muted">
                        Archived
                      </span>
                    )}
                    {project.description && (
                      <p className="mt-0.5 line-clamp-2 max-w-prose text-xs text-muted">
                        {project.description}
                      </p>
                    )}
                  </div>
                </div>
              </th>
              <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                {project.openCount}
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-muted">
                {project.ticketCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
