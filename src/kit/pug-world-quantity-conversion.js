/* Unit conversion is an explicit solver link with a declared input and output. */
(function (K) {
  const {runtime, data:{check}} = K.world, U = K.quantities;
  runtime.register('quantity-convert', config => {
    const {from, to, type = 'number'} = config;
    check(Object.keys(config).every(key => ['from','to','type'].includes(key)) && ['number','vec3'].includes(type),
      'Quantity conversion needs from and to quantities with a number or vec3 type');
    const convert = U.converter(from,to);
    const zero = type === 'number' ? 0 : [0,0,0];
    const initial = convert(zero);
    return {
      combinational:true,
      inputs:{value:{type,quantity:from}},
      outputs:{value:{type,quantity:to,default:initial}},
      initial:() => initial,
      step:(_, {input}) => convert(input.value),
      output:value => ({value})
    };
  });
})(KIT);
