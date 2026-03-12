import { Badge } from '@/components/ui/badge';
import { Globe } from 'lucide-react';

export function GwiBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={`text-xs text-emerald-600 border-emerald-600 ${className || ''}`}>
      <Globe className="h-3 w-3 mr-1" />
      GWI
    </Badge>
  );
}
