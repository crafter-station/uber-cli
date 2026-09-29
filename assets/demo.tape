Output assets/demo.gif

Set Shell zsh
Set FontSize 15
Set FontFamily "Menlo"
Set Width 1300
Set Height 1080
Set Padding 28
Set Theme "Builtin Dark"
Set TypingSpeed 45ms
Set CursorBlink false

Hide
Type "export UBER_OUTPUT=human PS1='%F{8}❯%f ' RPROMPT=''"
Enter
Type `uber() { command uber "$@" 2>&1 | perl -CSD -pe 's/(Mastercard|Visa|Amex)\s+\x{2022}+\s*\d{4}( \([^)]*\))?/Visa \x{2022}\x{2022}\x{2022}\x{2022}4242/g' }`
Enter
Type "clear"
Enter
Show

Sleep 600ms
Type "uber --help"
Sleep 400ms
Enter
Sleep 3.5s

Type "clear"
Enter
Type `uber rides estimate --from "Parque de la 93" --to "Aeropuerto El Dorado"`
Sleep 500ms
Enter
Wait+Screen@25s /next/
Sleep 6s

Type "clear"
Enter
Type `uber rides request --from "Parque de la 93" --to "Aeropuerto El Dorado" --product Comfort`
Sleep 500ms
Enter
Wait+Screen@25s /Nothing is booked/
Sleep 7s
