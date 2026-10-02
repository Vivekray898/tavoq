import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";

/**
 * A person shown as an avatar with a monogram fallback.
 *
 * Every place the app shows "who" uses this, so avatar size and
 * fallback initials never drift between screens. The square is fixed
 * on purpose: a missing image must not change the row height and
 * shift the table.
 */

const SIZES = {
  xs: "size-5 text-[10px]",
  sm: "size-6 text-[11px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const;

export interface EntityAvatarProps {
  name: string | null | undefined;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

export function EntityAvatar({
  name,
  src,
  size = "sm",
  className,
}: EntityAvatarProps) {
  return (
    <Avatar className={cn(SIZES[size], className)}>
      {/* Base UI renders the fallback until the image actually loads,
          which avoids a broken-image flash on slow connections. */}
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className="bg-muted font-medium text-muted-foreground">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}