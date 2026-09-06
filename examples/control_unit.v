// AURORA / control_unit
// Combinational reference design · portable Verilog subset
// Edit this module, then choose Synthesize (Ctrl+Enter).

module control_unit (
    input  wire req,
    input  wire ready,
    input  wire enable,
    input  wire reset_n,
    input  wire mode,
    output wire grant,
    output wire busy,
    output wire valid,
    output wire parity,
    output wire selected
);

    wire request_ok;
    assign request_ok = req & enable;
    assign grant      = request_ok & ready;
    assign busy       = req & ~ready;
    assign valid      = grant & reset_n;
    assign parity     = req ^ ready ^ mode;
    assign selected   = mode ? req : ready;

endmodule
