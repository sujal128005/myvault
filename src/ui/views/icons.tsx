import { AppWindow, AtSign, Briefcase, Clapperboard, Code2, Globe, Landmark, MessageCircle, MoreHorizontal, ShoppingBag, StickyNote } from 'lucide-react';
import type { Category } from '../../core/model';

export function CategoryIcon({ id }: { id: Category }) {
  switch (id) {
    case 'website':
      return <Globe />;
    case 'app':
      return <AppWindow />;
    case 'email':
      return <AtSign />;
    case 'finance':
      return <Landmark />;
    case 'social':
      return <MessageCircle />;
    case 'shopping':
      return <ShoppingBag />;
    case 'work':
      return <Briefcase />;
    case 'developer':
      return <Code2 />;
    case 'entertainment':
      return <Clapperboard />;
    case 'note':
      return <StickyNote />;
    default:
      return <MoreHorizontal />;
  }
}
