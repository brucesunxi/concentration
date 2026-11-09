import type { AgeBand, Locale, TaskId } from '../task-engine/index.ts';
import { taskContent } from './copy.ts';

/** Age, practice language, and the current course world. The product name is not a world. */
export function childCardSubtitle(child: { ageBand: AgeBand; locale: Locale; course: { task: TaskId; complete: boolean } }): string {
  const language = child.locale === 'en' ? 'English' : '简体中文';
  if (child.course.complete) return `${child.ageBand} · ${language}`;
  return `${child.ageBand} · ${language} · ${taskContent(child.course.task, child.locale, child.ageBand).title}`;
}
