"use client"

import PhoneInput, { isValidPhoneNumber, type Value } from "react-phone-number-input"
import { cn } from "@/lib/utils"

export function InternationalPhoneInput({ value, onChange, invalid, disabled, id = "contact-phone" }: { value: string; onChange: (value: string) => void; invalid?: boolean; disabled?: boolean; id?: string }) {
  return (
    <PhoneInput
      id={id}
      international
      countryCallingCodeEditable={false}
      defaultCountry="US"
      value={value as Value}
      disabled={disabled}
      onChange={(next) => onChange(next ?? "")}
      className={cn(
        "flex h-11 rounded-md border bg-background px-3 text-sm shadow-xs transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 [&_.PhoneInputCountry]:mr-3 [&_.PhoneInputCountryIcon]:overflow-hidden [&_.PhoneInputCountryIcon]:rounded-sm [&_.PhoneInputCountrySelectArrow]:text-muted-foreground [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:flex-1 [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:outline-none",
        invalid && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
      )}
      numberInputProps={{ autoComplete: "tel", "aria-invalid": invalid }}
    />
  )
}

export function validInternationalPhone(value: string) {
  return !value || isValidPhoneNumber(value)
}
