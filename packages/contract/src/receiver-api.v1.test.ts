import { describe, expect, it } from 'vitest';
import {
  listProjectsResponseSchema,
  receiverRouteTemplates,
  receiverRoutes,
  taskStateResponseSchema,
} from './receiver-api.v1';

describe('receiver api v1', () => {
  it('parses every remote status phase', () => {
    const statuses = [
      { phase: 'queued' },
      { phase: 'working' },
      { phase: 'needs-input', question: { id: 'q1', text: 'All breakpoints?', options: ['Yes'] } },
      { phase: 'result-ready', resultUrl: 'https://github.com/acme/web/pull/1' },
      { phase: 'failed', reason: 'Could not locate the component' },
      { phase: 'closed' },
    ];
    for (const status of statuses) {
      const parsed = taskStateResponseSchema.safeParse({
        remoteId: 'r1',
        status,
        pollAfterSec: 30,
      });
      expect(parsed.success, JSON.stringify(status)).toBe(true);
    }
  });

  it('rejects unknown phases and non-positive poll intervals', () => {
    expect(
      taskStateResponseSchema.safeParse({
        remoteId: 'r1',
        status: { phase: 'x' },
        pollAfterSec: 30,
      }).success,
    ).toBe(false);
    expect(
      taskStateResponseSchema.safeParse({
        remoteId: 'r1',
        status: { phase: 'queued' },
        pollAfterSec: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts a result only as a web page', () => {
    const report = (resultUrl: string) =>
      taskStateResponseSchema.safeParse({
        remoteId: 'r1',
        status: { phase: 'result-ready', resultUrl },
        pollAfterSec: 30,
      }).success;
    expect(report('https://github.com/acme/web/pull/1')).toBe(true);
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'chrome-extension://id/x']) {
      expect({ unsafe, accepted: report(unsafe) }).toEqual({ unsafe, accepted: false });
    }
  });

  it('encodes remote ids in routes', () => {
    expect(receiverRoutes.getTask('a/b')).toBe('/v1/tasks/a%2Fb');
    expect(receiverRoutes.replyToTask('r1')).toBe('/v1/tasks/r1/replies');
  });

  it('reads the model credential policy when a receiver states it, and not otherwise', () => {
    const projects = [{ id: 'acme', name: 'Acme' }];
    expect(listProjectsResponseSchema.parse({ projects, modelCredential: 'required' })).toEqual({
      projects,
      modelCredential: 'required',
    });
    expect(listProjectsResponseSchema.parse({ projects })).toEqual({ projects });
    expect(
      listProjectsResponseSchema.safeParse({ projects, modelCredential: 'always' }).success,
    ).toBe(false);
  });

  it('declares the same paths for servers as it builds for clients', () => {
    const id = 'task 1/x';
    const fill = (template: string) => template.replace(':remoteId', encodeURIComponent(id));
    expect(fill(receiverRouteTemplates.listProjects)).toBe(receiverRoutes.listProjects());
    expect(fill(receiverRouteTemplates.submitTask)).toBe(receiverRoutes.submitTask());
    expect(fill(receiverRouteTemplates.getTask)).toBe(receiverRoutes.getTask(id));
    expect(fill(receiverRouteTemplates.replyToTask)).toBe(receiverRoutes.replyToTask(id));
  });
});
