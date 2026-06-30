import { formatPhoneDisplay, phoneToTelLink } from "@/lib/phone";
import { cn } from "@/lib/utils";

type PhoneLinkProps = {
  phone: string | null | undefined;
  className?: string;
};

export function PhoneLink({ phone, className }: PhoneLinkProps) {
  if (!phone?.trim()) return null;

  const display = formatPhoneDisplay(phone);
  const tel = phoneToTelLink(phone);

  if (tel) {
    return (
      <a
        href={tel}
        className={cn("text-primary underline-offset-2 hover:underline", className)}
      >
        {display}
      </a>
    );
  }

  return <span className={className}>{display}</span>;
}
