// Content MVP v0: 4 skills filled, others to be added.
// Schema notes:
// - diagnostic: a small set of questions used in the entry diagnostic
// - practice: per-skill practice bank (goal: 10+ per skill)

export const SKILLS = [
  {
    id: 'mole',
    name: '莫耳與粒子數（NA）',
    blurb: 'n、N、NA 的互換；粒子數概念',
    diagnostic: [
      {
        id: 'mole_d1',
        kind: 'mc',
        stem: '1 mol 的粒子數約等於多少？',
        choices: ['6.02×10^23', '3.01×10^23', '1.00×10^23', '9.81×10^23'],
        answer: 0,
        explanation: '阿伏加德羅常數 NA ≈ 6.02×10^23 mol⁻¹。',
        wrongReasonTags: ['NA記憶錯', '指數/科學記號錯']
      },
      {
        id: 'mole_d2',
        kind: 'mc',
        stem: '0.50 mol 的 CO2 分子數約為多少？',
        choices: ['3.01×10^23', '6.02×10^23', '1.20×10^24', '2.00×10^23'],
        answer: 0,
        explanation: 'N = n·NA = 0.50×6.02×10^23 = 3.01×10^23。',
        wrongReasonTags: ['公式套用錯', '小數乘法錯', '指數運算錯']
      },
      {
        id: 'mole_d3',
        kind: 'mc',
        stem: '若某樣品含 1.204×10^24 個粒子，約為幾 mol？',
        choices: ['0.50 mol', '1.0 mol', '2.0 mol', '6.02 mol'],
        answer: 2,
        explanation: 'n = N/NA = (1.204×10^24)/(6.02×10^23) ≈ 2.0 mol。',
        wrongReasonTags: ['除法/指數錯', 'NA使用錯']
      }
    ],
    practice: [
      {
        id: 'mole_p1',
        kind: 'mc',
        stem: '2.0 mol 的 O2 分子數約為多少？',
        choices: ['1.204×10^24', '6.02×10^23', '3.01×10^23', '2.0×10^23'],
        answer: 0,
        explanation: 'N = 2.0×6.02×10^23 = 1.204×10^24。',
        wrongReasonTags: ['公式套用錯', 'NA倍數錯']
      },
      {
        id: 'mole_p2',
        kind: 'mc',
        stem: '0.25 mol 的 NaCl 含有多少個「化學式單位」？',
        choices: ['1.505×10^23', '6.02×10^23', '3.01×10^23', '2.408×10^24'],
        answer: 0,
        explanation: '以「化學式單位」視為粒子：N = 0.25×NA = 1.505×10^23。',
        wrongReasonTags: ['粒子種類搞混', '倍數錯']
      },
      {
        id: 'mole_p3',
        kind: 'mc',
        stem: '3.01×10^23 個 H2O 分子約為幾 mol？',
        choices: ['0.50', '1.0', '2.0', '5.0'],
        answer: 0,
        explanation: 'n = N/NA = (3.01×10^23)/(6.02×10^23) = 0.50。',
        wrongReasonTags: ['除法/指數錯']
      },
      {
        id: 'mole_p4',
        kind: 'mc',
        stem: '若 n = 0.10 mol，粒子數 N 約為？',
        choices: ['6.02×10^22', '6.02×10^23', '6.02×10^21', '1.0×10^23'],
        answer: 0,
        explanation: 'N = 0.10×6.02×10^23 = 6.02×10^22。',
        wrongReasonTags: ['小數點位移錯', '指數錯']
      },
      {
        id: 'mole_p5',
        kind: 'mc',
        stem: '同樣是 1 mol，下列哪個「粒子數」一定相同？',
        choices: ['1 mol H2 與 1 mol He 的分子數', '1 mol CO2 與 1 mol NaCl 的粒子數', '1 mol O2 與 1 mol O 的粒子數', '以上皆是'],
        answer: 3,
        explanation: '1 mol 代表同樣的粒子數 NA，但粒子定義要一致；題目中都在比較「粒子數」概念（分子/原子/式單位都各自為粒子），1 mol 都是 NA 個粒子。',
        wrongReasonTags: ['粒子定義混淆']
      },
      {
        id: 'mole_p6',
        kind: 'mc',
        stem: '0.50 mol 的 O2 含有多少 mol 的 O 原子？',
        choices: ['0.25', '0.50', '1.0', '2.0'],
        answer: 2,
        explanation: '0.50 mol O2 分子，每個分子 2 個 O 原子，所以 O 原子為 1.0 mol。',
        wrongReasonTags: ['係數/倍數錯', '分子內原子數忽略']
      },
      {
        id: 'mole_p7',
        kind: 'mc',
        stem: '1.0 mol 的 CH4 含有多少 mol 的 H 原子？',
        choices: ['1.0', '2.0', '4.0', '5.0'],
        answer: 2,
        explanation: '每個 CH4 有 4 個 H，故 H 原子 mol 數為 4.0 mol。',
        wrongReasonTags: ['下標倍數錯']
      },
      {
        id: 'mole_p8',
        kind: 'mc',
        stem: '若某樣品含 6.02×10^22 個粒子，約為幾 mol？',
        choices: ['0.01', '0.10', '1.0', '10'],
        answer: 1,
        explanation: 'n = N/NA = (6.02×10^22)/(6.02×10^23) = 0.10。',
        wrongReasonTags: ['指數比較錯']
      },
      {
        id: 'mole_p9',
        kind: 'mc',
        stem: '0.20 mol 的 Al2O3 含有多少 mol 的 O 原子？',
        choices: ['0.20', '0.40', '0.60', '1.0'],
        answer: 2,
        explanation: '每個 Al2O3 有 3 個 O，故 O 原子為 0.20×3=0.60 mol。',
        wrongReasonTags: ['下標倍數錯']
      },
      {
        id: 'mole_p10',
        kind: 'mc',
        stem: '關於 mol 的敘述何者正確？',
        choices: ['1 mol 一定是 6.02×10^23 g', '1 mol 代表固定質量', '1 mol 代表固定粒子數', '1 mol 代表固定體積'],
        answer: 2,
        explanation: 'mol 是物質的量單位，定義對應固定粒子數 NA。',
        wrongReasonTags: ['定義混淆']
      }
    ]
  },

  {
    id: 'molar-mass',
    name: '分子量/式量與化學式計算',
    blurb: '由化學式算 Mr；常見式量',
    diagnostic: [
      {
        id: 'mm_d1',
        kind: 'mc',
        stem: 'H2O 的相對分子量 Mr 為？(H=1, O=16)',
        choices: ['17', '18', '16', '20'],
        answer: 1,
        explanation: 'Mr = 2×1 + 16 = 18。',
        wrongReasonTags: ['加總錯', '下標倍數漏掉']
      },
      {
        id: 'mm_d2',
        kind: 'mc',
        stem: 'CaCO3 的式量為？(Ca=40, C=12, O=16)',
        choices: ['100', '96', '104', '112'],
        answer: 0,
        explanation: '40 + 12 + 3×16 = 100。',
        wrongReasonTags: ['括號/下標倍數錯', '加總錯']
      }
    ],
    practice: [
      {
        id: 'mm_p1',
        kind: 'mc',
        stem: 'CO2 的 Mr 為？(C=12,O=16)',
        choices: ['28', '32', '44', '48'],
        answer: 2,
        explanation: '12 + 2×16 = 44。',
        wrongReasonTags: ['下標倍數錯']
      },
      {
        id: 'mm_p2',
        kind: 'mc',
        stem: 'Na2SO4 的式量為？(Na=23,S=32,O=16)',
        choices: ['110', '142', '138', '120'],
        answer: 1,
        explanation: '2×23 + 32 + 4×16 = 142。',
        wrongReasonTags: ['倍數錯', '加總錯']
      },
      {
        id: 'mm_p3',
        kind: 'mc',
        stem: 'Al(OH)3 的式量為？(Al=27,O=16,H=1)',
        choices: ['78', '69', '60', '84'],
        answer: 0,
        explanation: '27 + 3×(16+1) = 78。',
        wrongReasonTags: ['括號倍數錯']
      },
      {
        id: 'mm_p4',
        kind: 'mc',
        stem: 'NH3 的 Mr 為？(N=14,H=1)',
        choices: ['15', '16', '17', '18'],
        answer: 2,
        explanation: '14 + 3×1 = 17。',
        wrongReasonTags: ['下標倍數漏掉']
      },
      {
        id: 'mm_p5',
        kind: 'mc',
        stem: 'MgCl2 的式量為？(Mg=24, Cl=35.5)',
        choices: ['59.5', '95', '71', '60'],
        answer: 1,
        explanation: '24 + 2×35.5 = 95。',
        wrongReasonTags: ['小數加總錯', '下標倍數錯']
      },
      {
        id: 'mm_p6',
        kind: 'mc',
        stem: '下列何者 Mr 最大？(以整數原子量估算：C=12,H=1,O=16)',
        choices: ['CH4', 'C2H6', 'C2H4', 'C3H8'],
        answer: 3,
        explanation: 'CH4=16；C2H6=30；C2H4=28；C3H8=44，最大為 C3H8。',
        wrongReasonTags: ['比較策略錯']
      },
      {
        id: 'mm_p7',
        kind: 'mc',
        stem: 'KNO3 的式量為？(K=39,N=14,O=16)',
        choices: ['85', '101', '93', '87'],
        answer: 1,
        explanation: '39 + 14 + 3×16 = 101。',
        wrongReasonTags: ['下標倍數錯']
      },
      {
        id: 'mm_p8',
        kind: 'mc',
        stem: 'Ca(OH)2 的式量為？(Ca=40,O=16,H=1)',
        choices: ['57', '74', '58', '72'],
        answer: 1,
        explanation: '40 + 2×(16+1)=74。',
        wrongReasonTags: ['括號倍數錯']
      },
      {
        id: 'mm_p9',
        kind: 'mc',
        stem: 'Fe2O3 的式量為？(Fe=56,O=16)',
        choices: ['160', '112', '176', '144'],
        answer: 0,
        explanation: '2×56 + 3×16 = 160。',
        wrongReasonTags: ['倍數錯']
      },
      {
        id: 'mm_p10',
        kind: 'mc',
        stem: '化學式中括號/下標的意義，何者正確？',
        choices: ['下標代表元素的原子量', '括號外下標會乘進括號內每個元素', '括號只用於離子化合物', '括號外下標只乘第一個元素'],
        answer: 1,
        explanation: '例如 Al(OH)3：括號外 3 會乘 O 與 H。',
        wrongReasonTags: ['括號倍數概念錯']
      }
    ]
  },

  {
    id: 'stoichiometry',
    name: '化學計量（莫耳比、質量比）',
    blurb: '由配平方程式建立莫耳比；由莫耳轉質量',
    diagnostic: [
      {
        id: 'st_d1',
        kind: 'mc',
        stem: '反應：2H2 + O2 → 2H2O。若 4 mol H2 完全反應，需要幾 mol O2？',
        choices: ['1', '2', '4', '8'],
        answer: 1,
        explanation: '莫耳比 H2:O2 = 2:1。4 mol H2 需要 2 mol O2。',
        wrongReasonTags: ['莫耳比讀取錯', '倍數換算錯']
      },
      {
        id: 'st_d2',
        kind: 'mc',
        stem: '反應：CaCO3 → CaO + CO2。1 mol CaCO3 生成幾 mol CO2？',
        choices: ['0.5', '1', '2', '3'],
        answer: 1,
        explanation: '係數 1:1，所以 1 mol 生成 1 mol。',
        wrongReasonTags: ['係數對應錯']
      }
    ],
    practice: [
      {
        id: 'st_p1',
        kind: 'mc',
        stem: 'N2 + 3H2 → 2NH3。若 6 mol H2 完全反應，需要幾 mol N2？',
        choices: ['1', '2', '3', '6'],
        answer: 1,
        explanation: 'H2:N2=3:1。6 mol H2 對應 2 mol N2。',
        wrongReasonTags: ['莫耳比錯']
      },
      {
        id: 'st_p2',
        kind: 'mc',
        stem: '2CO + O2 → 2CO2。若有 0.50 mol O2，可反應多少 mol CO？',
        choices: ['0.25', '0.50', '1.0', '2.0'],
        answer: 2,
        explanation: 'CO:O2=2:1。0.50 mol O2 可反應 1.0 mol CO。',
        wrongReasonTags: ['莫耳比錯']
      },
      {
        id: 'st_p3',
        kind: 'mc',
        stem: '4Fe + 3O2 → 2Fe2O3。若 8 mol Fe 反應，需幾 mol O2？',
        choices: ['3', '4', '6', '8'],
        answer: 2,
        explanation: 'Fe:O2=4:3。8 mol Fe 需要 6 mol O2。',
        wrongReasonTags: ['莫耳比錯', '倍數換算錯']
      },
      {
        id: 'st_p4',
        kind: 'mc',
        stem: 'CaCO3 → CaO + CO2。若 10 g CaCO3（式量 100）完全分解，生成多少 mol CO2？',
        choices: ['0.01', '0.05', '0.10', '1.0'],
        answer: 2,
        explanation: 'n(CaCO3)=10/100=0.10 mol；莫耳比 1:1，所以 CO2=0.10 mol。',
        wrongReasonTags: ['質量轉莫耳錯', '莫耳比錯']
      },
      {
        id: 'st_p5',
        kind: 'mc',
        stem: '2H2 + O2 → 2H2O。若 9 g H2（Mr=2）完全反應，生成幾 mol H2O？',
        choices: ['1', '4.5', '9', '18'],
        answer: 1,
        explanation: 'n(H2)=9/2=4.5 mol；H2:H2O=1:1（2→2），生成 4.5 mol。',
        wrongReasonTags: ['係數化簡錯', '質量轉莫耳錯']
      },
      {
        id: 'st_p6',
        kind: 'mc',
        stem: '2Na + Cl2 → 2NaCl。若有 3.0 mol Na，最多生成幾 mol NaCl？',
        choices: ['1.5', '3.0', '6.0', '0.67'],
        answer: 1,
        explanation: 'Na:NaCl=2:2=1:1，所以 3.0 mol Na 生成 3.0 mol NaCl（若 Cl2 足夠）。',
        wrongReasonTags: ['係數對應錯']
      },
      {
        id: 'st_p7',
        kind: 'mc',
        stem: 'CH4 + 2O2 → CO2 + 2H2O。若有 2.0 mol CH4，生成幾 mol H2O？',
        choices: ['1.0', '2.0', '4.0', '8.0'],
        answer: 2,
        explanation: 'CH4:H2O=1:2。2.0 mol CH4 生成 4.0 mol H2O。',
        wrongReasonTags: ['莫耳比錯']
      },
      {
        id: 'st_p8',
        kind: 'mc',
        stem: '2Al + 3Cl2 → 2AlCl3。若生成 1.0 mol AlCl3，消耗幾 mol Cl2？',
        choices: ['0.5', '1.0', '1.5', '3.0'],
        answer: 2,
        explanation: 'Cl2:AlCl3 = 3:2。1.0 mol AlCl3 需要 1.5 mol Cl2。',
        wrongReasonTags: ['莫耳比錯']
      },
      {
        id: 'st_p9',
        kind: 'mc',
        stem: '2H2 + O2 → 2H2O。已知消耗 1.0 mol O2，生成幾 mol H2O？',
        choices: ['1.0', '2.0', '0.5', '4.0'],
        answer: 1,
        explanation: 'O2:H2O=1:2。',
        wrongReasonTags: ['莫耳比錯']
      },
      {
        id: 'st_p10',
        kind: 'mc',
        stem: '下列關於化學計量的步驟，何者最關鍵？',
        choices: ['先背所有式量', '先把方程式配平再談莫耳比', '先把濃度算出來', '先把體積換成質量'],
        answer: 1,
        explanation: '莫耳比來自配平係數；配平是計量的地基。',
        wrongReasonTags: ['流程概念錯']
      }
    ]
  },

  {
    id: 'molarity',
    name: '溶液濃度（莫耳濃度 M、稀釋）',
    blurb: 'M = n/V；稀釋 M1V1=M2V2',
    diagnostic: [
      {
        id: 'mo_d1',
        kind: 'mc',
        stem: '0.50 mol 溶質溶於 1.0 L 溶液中，莫耳濃度為？',
        choices: ['0.50 M', '1.0 M', '2.0 M', '0.25 M'],
        answer: 0,
        explanation: 'M = n/V = 0.50/1.0 = 0.50 M。',
        wrongReasonTags: ['公式套用錯']
      },
      {
        id: 'mo_d2',
        kind: 'mc',
        stem: '將 100 mL 的 2.0 M 溶液稀釋至 400 mL，新濃度為？',
        choices: ['0.50 M', '1.0 M', '2.0 M', '8.0 M'],
        answer: 0,
        explanation: 'M1V1=M2V2 → 2.0×0.100 = M2×0.400 → M2=0.50 M（注意體積要用 L）。',
        wrongReasonTags: ['mL/L換算錯', '稀釋公式錯']
      },
      {
        id: 'mo_d3',
        kind: 'mc',
        stem: '0.20 M 溶液取 50.0 mL，其中溶質有多少 mol？',
        choices: ['0.010', '0.020', '0.100', '0.200'],
        answer: 0,
        explanation: 'n = M·V = 0.20×0.0500 = 0.0100 mol（50.0 mL = 0.0500 L）。',
        wrongReasonTags: ['mL/L換算錯', 'n=M·V套用錯']
      }
    ],
    practice: [
      {
        id: 'mo_p1',
        kind: 'mc',
        stem: '1.0 mol 溶質配成 0.50 L 溶液，濃度為？',
        choices: ['0.50', '1.0', '2.0', '0.20'],
        answer: 2,
        explanation: 'M = 1.0/0.50 = 2.0 M。',
        wrongReasonTags: ['公式套用錯']
      },
      {
        id: 'mo_p2',
        kind: 'mc',
        stem: '250 mL 的 0.20 M NaCl 溶液含有多少 mol NaCl？',
        choices: ['0.05', '0.50', '0.005', '0.20'],
        answer: 0,
        explanation: 'n = M·V = 0.20×0.250 = 0.050 mol。',
        wrongReasonTags: ['mL/L換算錯']
      },
      {
        id: 'mo_p3',
        kind: 'mc',
        stem: '50.0 mL 的 1.5 M HCl 含有多少 mol HCl？',
        choices: ['0.075', '0.15', '0.030', '0.50'],
        answer: 0,
        explanation: 'n = 1.5×0.0500 = 0.0750 mol。',
        wrongReasonTags: ['mL/L換算錯', '乘法錯']
      },
      {
        id: 'mo_p4',
        kind: 'mc',
        stem: '要配製 500 mL 的 0.10 M 溶液，需要多少 mol 溶質？',
        choices: ['0.05', '0.10', '0.20', '0.50'],
        answer: 0,
        explanation: 'n = M·V = 0.10×0.500 = 0.050 mol。',
        wrongReasonTags: ['mL/L換算錯']
      },
      {
        id: 'mo_p5',
        kind: 'mc',
        stem: '將 100 mL 的 1.0 M 溶液稀釋到 250 mL，新濃度為？',
        choices: ['0.40', '0.25', '2.5', '1.5'],
        answer: 0,
        explanation: 'M2 = M1V1/V2 = 1.0×0.100/0.250 = 0.40 M。',
        wrongReasonTags: ['稀釋公式錯']
      },
      {
        id: 'mo_p6',
        kind: 'mc',
        stem: '若某溶液濃度 0.50 M，體積 2.0 L，含溶質多少 mol？',
        choices: ['0.25', '1.0', '2.0', '4.0'],
        answer: 1,
        explanation: 'n = M·V = 0.50×2.0 = 1.0 mol。',
        wrongReasonTags: ['公式套用錯']
      },
      {
        id: 'mo_p7',
        kind: 'mc',
        stem: '從 2.0 M 儲備液取用多少 mL，稀釋成 250 mL 的 0.50 M？',
        choices: ['25', '50', '62.5', '125'],
        answer: 2,
        explanation: 'M1V1=M2V2 → 2.0·V1 = 0.50·0.250 → V1 = 0.0625 L = 62.5 mL。',
        wrongReasonTags: ['稀釋公式錯', 'mL/L換算錯']
      },
      {
        id: 'mo_p8',
        kind: 'mc',
        stem: '關於稀釋，下列何者正確？',
        choices: ['稀釋後溶質 mol 數不變', '稀釋後溶質質量會增加', '稀釋後體積變小', '稀釋後濃度一定變大'],
        answer: 0,
        explanation: '加溶劑不改變溶質的 mol 數，但體積變大、濃度變小。',
        wrongReasonTags: ['概念錯']
      },
      {
        id: 'mo_p9',
        kind: 'mc',
        stem: '0.10 M 溶液的濃度表示什麼？',
        choices: ['每 1 L 溶液含 0.10 mol 溶質', '每 1 L 溶液含 0.10 g 溶質', '每 1 mol 溶液含 0.10 L 溶質', '每 1 L 溶液含 0.10 mol 溶劑'],
        answer: 0,
        explanation: '莫耳濃度 M = mol 溶質 / L 溶液。',
        wrongReasonTags: ['定義錯']
      },
      {
        id: 'mo_p10',
        kind: 'mc',
        stem: '1.0 L 的 0.20 M 溶液，若取出 0.50 L，取出的溶液濃度為？',
        choices: ['0.10', '0.20', '0.40', '1.0'],
        answer: 1,
        explanation: '同一瓶溶液取出一部分，濃度不變（仍為 0.20 M）。',
        wrongReasonTags: ['取樣濃度概念錯']
      }
    ]
  }
];

export function getSkillById(id) {
  return SKILLS.find((s) => s.id === id) || null;
}

export function getAllDiagnosticQuestions() {
  return SKILLS.flatMap((s) => (s.diagnostic || []).map((q) => ({ ...q, skillId: s.id })));
}

export function getPracticeQuestionsForSkill(skillId) {
  const s = getSkillById(skillId);
  return (s?.practice || []).map((q) => ({ ...q, skillId }));
}
