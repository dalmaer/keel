// Shared by project pulses and fleet reports; CSS-only chevrons also work in
// offline artifacts whose CSP forbids images. Keep native select semantics.
export const SELECT_CSS = `
select{
  appearance:none;-webkit-appearance:none;
  min-height:44px;max-width:100%;line-height:1.4;
  padding:10px 42px 10px 14px;border-radius:8px;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 20px) 50%,calc(100% - 15px) 50%;
  background-size:5px 5px;background-repeat:no-repeat;
}
select:hover{border-color:currentColor}
select:focus-visible{outline:2px solid currentColor;outline-offset:3px}
select:disabled{opacity:.55;cursor:not-allowed}
@media(forced-colors:active){select{appearance:auto;background-image:none}}
@media(max-width:480px){fieldset label{width:100%}select{width:100%;min-width:0}}
`;
