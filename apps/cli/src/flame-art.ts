// The flame shown after `forge login`, drawn by the owner and shrunk to fit a terminal.
// FLAME is the shape; FLAME_HEAT gives each character's colour: r red, o orange, y yellow.

export const FLAME: readonly string[] = [
  '                ,',
  '                vv,',
  "                ,vvv'",
  "         /'     ,vvvv.",
  "         //'   ,vvvvv''",
  "        ////  ,vvvvvv'",
  "      '///   vvvvvvv''",
  "     '///  vvvvvvvv'//",
  "     '/  vvvvvvvv/'//     .",
  " v,    vvvvvvvv/'/''      QQ",
  "vvv   vvvvv/////'         QQQ",
  "vvv, vvvvv'////' .      .QQQv,",
  "vvv  vvv,  /'' .QQ.   .QQQQvv",
  " vv  vvv//''  QQQQQQQQQQvvvv",
  "  ,v  vv''' .QQQQQQQvvvvvv,",
  '       ,v/, QQQQQvvvvvvv',
  '         ,, QQQvvvvv,,',
  '             .Qv,',
];

export const FLAME_HEAT: readonly string[] = [
  '                o',
  '                ooo',
  '                oooor',
  '         rr     oooooy',
  '         rrr   oooooorr',
  '        rrrr  ooooooor',
  '      rrrr   ooooooorr',
  '     rrrr  oooooooorrr',
  '     rr  oooooooorrrr     y',
  ' oo    oooooooorrrrr      yy',
  'ooo   ooooorrrrrr         yyy',
  'oooo ooooorrrrrr y      yyyyoo',
  'ooo  oooo  rrr yyyy   yyyyyoo',
  ' oo  ooorrrr  yyyyyyyyyyoooo',
  '  oo  oorrr yyyyyyyyooooooo',
  '       ooro yyyyyooooooo',
  '         oo yyyooooooo',
  '             yyoo',
];
