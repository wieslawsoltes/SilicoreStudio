module adder (
    input wire [7:0] a,
    input wire [7:0] b,
    output wire [7:0] sum,
    output wire different
);
    assign sum = a + b;
    assign different = a != b;
endmodule
