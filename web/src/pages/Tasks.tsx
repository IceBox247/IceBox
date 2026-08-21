import { useStore } from '../store';
import { TaskItem } from '../components/TaskItem';
import { Mascot } from '../components/Mascot';

export function Tasks() {
  const { tasks } = useStore();
  const pending = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <div className="animate-fade-in space-y-5 px-5 pb-28 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold leading-tight">
            Complete
            <br />
            Tasks
          </h1>
          <p className="mt-1 text-white/50">Complete simple tasks and earn ICE</p>
        </div>
        <Mascot size={110} />
      </div>

      <div className="space-y-3">
        {pending.map((t) => (
          <TaskItem key={t.id} task={t} />
        ))}
      </div>

      {done.length > 0 && (
        <div className="space-y-3">
          <p className="pt-2 text-sm font-bold uppercase tracking-wide text-white/40">Completed</p>
          {done.map((t) => (
            <TaskItem key={t.id} task={t} />
          ))}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="card py-10 text-center text-white/50">No tasks right now. Check back soon ❄️</div>
      )}
    </div>
  );
}
