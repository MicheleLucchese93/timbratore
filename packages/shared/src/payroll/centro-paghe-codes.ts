// AUTO-GENERATED from "Giustificati standard CP.xlsx" (Centro Paghe giustificativo
// dictionary). Do not edit by hand — regenerate with scripts/gen-centro-paghe-codes.
//
// inp  = 2-char input code (VOCE 1 INP) — stable key, used as the 2-char export
//        form for single-page LUL tenants and as the mapping value stored on
//        tenants.cp_giustificativo_map.
// out  = up-to-4-char mnemonic (VOCE 1 OUT) — the export form for full-code
//        tenants (tenants.cp_code_len = 4).
// descr= description (record type 2, field DESCR. GIUSTIFICATIVO, max 30 bytes).

export interface CentroPagheCode {
  inp: string;
  out: string;
  descr: string;
}

export const CENTRO_PAGHE_CODES: readonly CentroPagheCode[] = [
  {
    "inp": "A0",
    "out": "ASS0",
    "descr": "ASSENZA INGIUSTIFICATA"
  },
  {
    "inp": "A1",
    "out": "ASS1",
    "descr": "ASS. NON RETRIBUITA NON SCALA ORE/G"
  },
  {
    "inp": "A2",
    "out": "ASS2",
    "descr": "ASS. NON RETRIBUITA SCALA ORE/GG RE"
  },
  {
    "inp": "A3",
    "out": "ASS3",
    "descr": "ASSENZA CON VOCE 0009"
  },
  {
    "inp": "A4",
    "out": "ASS4",
    "descr": "ASS. NON RETRIBUITA SCALA ORE/GG RE"
  },
  {
    "inp": "A5",
    "out": "ASS5",
    "descr": "ASS. NON RETRIBUITA SCALA ORE/GG RE"
  },
  {
    "inp": "A6",
    "out": "ASS6",
    "descr": "ASS. NON GIUSTIFICATA EDILI SCALA O"
  },
  {
    "inp": "A7",
    "out": "ASS7",
    "descr": "ASSENZA INGIUSTIFICATA GREEN PASS"
  },
  {
    "inp": "AA",
    "out": "ASSA",
    "descr": "ASSENZA CORONAVIRUS"
  },
  {
    "inp": "AC",
    "out": "ASCE",
    "descr": "ASSUNZ/CESSAZ"
  },
  {
    "inp": "AD",
    "out": "FCO",
    "descr": "ASSEGNO ORDINARIO ANTICIPO (NO ANF)"
  },
  {
    "inp": "AE",
    "out": "FCON",
    "descr": "ASSEGNO ORDINARIO SENZA ANTICIPO (N"
  },
  {
    "inp": "AF",
    "out": "FAOA",
    "descr": "ASSEGNO ORDINARIO AUTORIZZATO"
  },
  {
    "inp": "AG",
    "out": "FCOA",
    "descr": "ASSEGNO ORDINARIO AUTORIZZATO (NO A"
  },
  {
    "inp": "AH",
    "out": "FASA",
    "descr": "ASSEGNO SOLIDARIETA' AUTORIZZATO"
  },
  {
    "inp": "AI",
    "out": "FAS",
    "descr": "ASSEGNO SOLIDARIETA' ANTICIPO"
  },
  {
    "inp": "AL",
    "out": "ASSL",
    "descr": "ASSENTE DA CHIAMATA"
  },
  {
    "inp": "AM",
    "out": "ALLM",
    "descr": "ORE ALLATTAMENTO"
  },
  {
    "inp": "AN",
    "out": "FAON",
    "descr": "ASSEGNO ORDINARIO SENZA ANTICIPO"
  },
  {
    "inp": "AO",
    "out": "FAO",
    "descr": "ASSEGNO ORDINARIO ANTICIPO"
  },
  {
    "inp": "AP",
    "out": "ASPE",
    "descr": "ASPETTATIVA"
  },
  {
    "inp": "AQ",
    "out": "FASN",
    "descr": "ASSEGNO SOLIDARIETA' SENZA ANTICIPO"
  },
  {
    "inp": "AR",
    "out": "FBON",
    "descr": "FSBA ASSEGNO ORDINARIO SENZA ANTICI"
  },
  {
    "inp": "AS",
    "out": "ASSE",
    "descr": "ASSEMBLEA"
  },
  {
    "inp": "AT",
    "out": "FBSN",
    "descr": "FSBA ASSEGNO SOLIDARIETA' SENZA ANT"
  },
  {
    "inp": "AU",
    "out": "FBO",
    "descr": "FSBA ASSEGNO ORDINARIO CON ANTICIPO"
  },
  {
    "inp": "AV",
    "out": "FAOB",
    "descr": "ASSEGNO ORDINARIO ANTICIPO COVID-19"
  },
  {
    "inp": "AW",
    "out": "FAOC",
    "descr": "ASSEGNO ORDINARIO AUTORIZZATO COVID"
  },
  {
    "inp": "AX",
    "out": "CAIS",
    "descr": "COMPENSO AIS"
  },
  {
    "inp": "AY",
    "out": "CAIP",
    "descr": "COMPENSO AIS EVENTI ATM"
  },
  {
    "inp": "AZ",
    "out": "AUA",
    "descr": "AMMORTIZZATORE UNICO ALLUVIONATI"
  },
  {
    "inp": "BA",
    "out": "BPD0",
    "descr": "COD. PD0 / PD1 - LIMITE 6 MESI PER"
  },
  {
    "inp": "BB",
    "out": "BPE0",
    "descr": "COD. PE0 / PE1 - DI 7/8/9 MESI FIGL"
  },
  {
    "inp": "BC",
    "out": "BPB0",
    "descr": "COD.PB0 / PB1-OLTRE 9 MESI FINO 8 A"
  },
  {
    "inp": "BD",
    "out": "BTB0",
    "descr": "COD.TB0 / TB1-OLTRE 9 MESI DA 8 A 1"
  },
  {
    "inp": "BE",
    "out": "BPB3",
    "descr": "COD.PB0 / PB1-OLTRE 9 MESI FINO 8 A"
  },
  {
    "inp": "BF",
    "out": "BTB3",
    "descr": "COD.TB0 / TB1-OLTRE 9 MESI DA 8 A 1"
  },
  {
    "inp": "BG",
    "out": "BRA1",
    "descr": "COD. RA1 - PERMESSI MENSILI L.104/9"
  },
  {
    "inp": "BH",
    "out": "BQB5",
    "descr": "COD. QB5 - PERMESSI ORARI L.104/92,"
  },
  {
    "inp": "BI",
    "out": "BTA1",
    "descr": "COD. TA1 - PERMESSI A GIORNI L.104/"
  },
  {
    "inp": "BJ",
    "out": "BMD1",
    "descr": "COD. MD1 - CONGEDO STRAORDINARIO IN"
  },
  {
    "inp": "BK",
    "out": "BYA1",
    "descr": "YA1 CONGEDO FIGLIO FINO 8 ANNI ART."
  },
  {
    "inp": "BL",
    "out": "BYA2",
    "descr": "YA2 CONGEDO FIGLIO 8-12 ANNI ART.33"
  },
  {
    "inp": "BM",
    "out": "BXB3",
    "descr": "COD. XB3 - PERMESSI ORARI D.LGS.151"
  },
  {
    "inp": "BN",
    "out": "BPG0",
    "descr": "COD. PG0 - CONGEDO PARENTALE A ORE"
  },
  {
    "inp": "BO",
    "out": "BPG1",
    "descr": "COD. PG1 - CONGEDO PARENTALE A GIOR"
  },
  {
    "inp": "BP",
    "out": "BPG2",
    "descr": "COD. PG2 - CONGEDO PARENTALE A ORE"
  },
  {
    "inp": "BQ",
    "out": "BPG3",
    "descr": "COD. PG3 - CONGEDO PARENTALE A GIOR"
  },
  {
    "inp": "BR",
    "out": "BTA2",
    "descr": "COD. TA1 - PERMESSI A GIORNI L.104/"
  },
  {
    "inp": "BS",
    "out": "BRA2",
    "descr": "COD. RA1 - PERM MENSILI L.104/92, A"
  },
  {
    "inp": "BT",
    "out": "FBR",
    "descr": "FSBA ASSEGNO ORDINARIO CON ANTICIPO"
  },
  {
    "inp": "BU",
    "out": "FBRN",
    "descr": "FSBA ASSEGNO ORDINARIO SENZA ANTICI"
  },
  {
    "inp": "BV",
    "out": "BPG4",
    "descr": "COD. PG4 - CONGEDO PARENTALE A ORE"
  },
  {
    "inp": "BW",
    "out": "BPG5",
    "descr": "COD. PG5 - CONGEDO PARENTALE A GIOR"
  },
  {
    "inp": "C0",
    "out": "MA4H",
    "descr": "CONGEDO PARENTALE COVID-19 HANDICAP"
  },
  {
    "inp": "C1",
    "out": "CPAF",
    "descr": "CONGEDO PATERNITA' FACOLTATIVA"
  },
  {
    "inp": "C2",
    "out": "CPAO",
    "descr": "CONGEDO PATERNITA' OBBLIGATORIO"
  },
  {
    "inp": "C3",
    "out": "COAM",
    "descr": "CISOA CON APPLICAZOINE DEI MASSIMAL"
  },
  {
    "inp": "C4",
    "out": "COAI",
    "descr": "CISOA INTEMPERIE NO APPLICAZIONE MA"
  },
  {
    "inp": "C5",
    "out": "MA7C",
    "descr": "MV5 COVID-19 ART. 33 COMMA 3 E 6 LE"
  },
  {
    "inp": "C6",
    "out": "MB5C",
    "descr": "MV4 COVID-19 ART. 33 COMMA 3 E 6 LE"
  },
  {
    "inp": "C7",
    "out": "MA4P",
    "descr": "CONGEDO PARENTALE COVID-19 12-16 AN"
  },
  {
    "inp": "C8",
    "out": "CTR",
    "descr": "DA NON UTILIZZARE"
  },
  {
    "inp": "C9",
    "out": "MA4C",
    "descr": "CONGEDO PARENTALE COVID-19 0-12 ANN"
  },
  {
    "inp": "CA",
    "out": "CONA",
    "descr": "CONTO ORE ACCANTONATE RECUPERO CON"
  },
  {
    "inp": "CB",
    "out": "CINI",
    "descr": "CIG ORDINARIA NON INTEGRATA"
  },
  {
    "inp": "CC",
    "out": "FORS",
    "descr": "CORSO DI FORMAZIONE SICUREZZA EDILI"
  },
  {
    "inp": "CD",
    "out": "CMT1",
    "descr": "CONGEDO MATRIMONIALE DITTA"
  },
  {
    "inp": "CE",
    "out": "CIEM",
    "descr": "CIG EDILI EVENTI ATMOSFERICI"
  },
  {
    "inp": "CF",
    "out": "FORM",
    "descr": "CORSO DI FORMAZIONE"
  },
  {
    "inp": "CG",
    "out": "CONG",
    "descr": "CONTO ORE GODUTE"
  },
  {
    "inp": "CH",
    "out": "CGSA",
    "descr": "CIG STRAORDINARIA CON ANTICIPO"
  },
  {
    "inp": "CI",
    "out": "CMT2",
    "descr": "CONGEDO MATRIMONIALE INPS"
  },
  {
    "inp": "CJ",
    "out": "CIGD",
    "descr": "CIG IN DEROGA SENZA ANTICIPO"
  },
  {
    "inp": "CK",
    "out": "CIES",
    "descr": "CIG EDILI SENZA ANTICIPO EVENTI ATM"
  },
  {
    "inp": "CL",
    "out": "COAN",
    "descr": "CISOA SENZA ANTICIPO DAL DATORE"
  },
  {
    "inp": "CM",
    "out": "CIGM",
    "descr": "CIG ORDINARIA CON ANTICIPO"
  },
  {
    "inp": "CN",
    "out": "CIGN",
    "descr": "CIG ORDINARIA SENZA ANTICIPO"
  },
  {
    "inp": "CO",
    "out": "CGFA",
    "descr": "CIG IN DEROGA TN/BZCON ANTICIPO"
  },
  {
    "inp": "CP",
    "out": "PMMF",
    "descr": "PERMESSO MOTIVI FAMILIARI L.53/2000"
  },
  {
    "inp": "CQ",
    "out": "MA4Q",
    "descr": "CONGEDO PARENTALE COVID-19 0-14 ANN"
  },
  {
    "inp": "CR",
    "out": "MA4R",
    "descr": "CONGEDO STRAORDINARIO FIGLI DL N. 1"
  },
  {
    "inp": "CS",
    "out": "CIGS",
    "descr": "CIG STRAORDINARIA SENZA ANTICIPO"
  },
  {
    "inp": "CT",
    "out": "CIGT",
    "descr": "CIGSCON ANTICIPO (sostituito con"
  },
  {
    "inp": "CU",
    "out": "MA4S",
    "descr": "CONGEDO 2021 PER GENITORI D.L. 30/2"
  },
  {
    "inp": "CV",
    "out": "CGFD",
    "descr": "CIG IN DEROGA TN/BZAUTORIZZATA"
  },
  {
    "inp": "CW",
    "out": "CGFS",
    "descr": "CIG IN DEROGA TN/BZ SENZA ANTICIPO"
  },
  {
    "inp": "CX",
    "out": "CGDA",
    "descr": "CIG IN DEROGACON ANTICIPO"
  },
  {
    "inp": "CY",
    "out": "COAL",
    "descr": "CISOA INTEMPERIE A ORE NO APPLICAZI"
  },
  {
    "inp": "CZ",
    "out": "RCOM",
    "descr": "RIPOSO COMPENSATIVO ELEZIONI"
  },
  {
    "inp": "D0",
    "out": "MA4D",
    "descr": "CONGEDO PARENTALE COVID-19 0-12 ANN"
  },
  {
    "inp": "D1",
    "out": "MA4I",
    "descr": "CONGEDO PARENTALE COVID-19 HANDICAP"
  },
  {
    "inp": "D2",
    "out": "DON2",
    "descr": "DONAZIONE SANGUE SENZA MAGG 1,20"
  },
  {
    "inp": "D3",
    "out": "DON3",
    "descr": "DONAZIONE SANGUE PER MENSILIZZATI"
  },
  {
    "inp": "D4",
    "out": "MA7D",
    "descr": "CONGEDO STRAORDINARIO DISABILI DL N"
  },
  {
    "inp": "D5",
    "out": "MA4A",
    "descr": "CONGEDO 2021 PER GENITORI A GIORNI"
  },
  {
    "inp": "D6",
    "out": "MA4B",
    "descr": "CONGEDO COVID PER GENITORI A ORE"
  },
  {
    "inp": "DA",
    "out": "MDFA",
    "descr": "MAGG. LAV.DOM. ALTRI CASI"
  },
  {
    "inp": "DC",
    "out": "DECR",
    "descr": "ORE DECREMENTO ROL"
  },
  {
    "inp": "DD",
    "out": "SDD",
    "descr": "STR. DIURNO DOM."
  },
  {
    "inp": "DF",
    "out": "SDDF",
    "descr": "STR. DIU DOM.FEST."
  },
  {
    "inp": "DG",
    "out": "DEGG",
    "descr": "DECREMENTO GIORNI IMPONIBILE CASSA"
  },
  {
    "inp": "DH",
    "out": "MDF2",
    "descr": "MAGG. LAV.DOM. ALTRI CASI 2"
  },
  {
    "inp": "DI",
    "out": "SOSD",
    "descr": "SOSPENSIONE DISCIPLINARE VOCE 0633"
  },
  {
    "inp": "DM",
    "out": "MDFD",
    "descr": "MAGG. LAV.DOM. E FES.DIURN"
  },
  {
    "inp": "DO",
    "out": "DMO",
    "descr": "DON. MIDOLLO OSSEO CON MAGG 1,20"
  },
  {
    "inp": "DP",
    "out": "DISP",
    "descr": "DISPONIBILITA'"
  },
  {
    "inp": "DR",
    "out": "MDDR",
    "descr": "MAGG. LAV.DOM. RIP. COMPEN"
  },
  {
    "inp": "DS",
    "out": "DON",
    "descr": "DONAZIONE SANGUE CON MAGG 1,20"
  },
  {
    "inp": "DU",
    "out": "MDIR",
    "descr": "MAGG. LAV DIURNO"
  },
  {
    "inp": "DV",
    "out": "DVV",
    "descr": "CONGEDO D.LGS 80/2015 ART. 24 (util"
  },
  {
    "inp": "DW",
    "out": "DVO",
    "descr": "CONGEDO D.LGS 80/2015 ART. 24 (util"
  },
  {
    "inp": "E1",
    "out": "EDI1",
    "descr": "ASSENZA GIUSTIFICATA PROSPETTO EDIL"
  },
  {
    "inp": "EA",
    "out": "EDIL",
    "descr": "ASSENZA GIUSTIFICATA PROSPETTO EDIL"
  },
  {
    "inp": "EB",
    "out": "FSBA",
    "descr": "Sospensione ore indennizzate da FSB"
  },
  {
    "inp": "EC",
    "out": "MDCS",
    "descr": "MAGG. CAPO SQUADRA EDILI"
  },
  {
    "inp": "ED",
    "out": "FERE",
    "descr": "FERIE EDILI INDUSTRIA OPERAI"
  },
  {
    "inp": "EF",
    "out": "EXFE",
    "descr": "EX FESTIVITA'"
  },
  {
    "inp": "EH",
    "out": "EBF",
    "descr": "SOSTEGNO REDDITO (ENTE BILATERALE)"
  },
  {
    "inp": "EI",
    "out": "EBI",
    "descr": "SOSTEGNO AL REDDITO (E.BI.PRO.)"
  },
  {
    "inp": "EO",
    "out": "EXFL",
    "descr": "EX. FE. AD ORE PER MENSILI - NON SC"
  },
  {
    "inp": "EP",
    "out": "FEPS",
    "descr": "FERIE A.P. CON GESTIONE DEL SABATO"
  },
  {
    "inp": "EQ",
    "out": "MDCQ",
    "descr": "MAGG. CAPO SQUADRA EDILI"
  },
  {
    "inp": "ES",
    "out": "MDSG",
    "descr": "MAGG. SESTA GIORNATA"
  },
  {
    "inp": "F0",
    "out": "FAP0",
    "descr": "FORMAZIONE INTERNA C/O AZIENDA20%"
  },
  {
    "inp": "F1",
    "out": "FORN",
    "descr": "FORMAZIONE PERSONALE PIANO INDUSTRI"
  },
  {
    "inp": "F2",
    "out": "MNF2",
    "descr": "MAGG. LAV. NOTT. FESTIVO ALTRI CASI"
  },
  {
    "inp": "F3",
    "out": "MTF",
    "descr": "MAGG. TURNI FEST. DIURNI"
  },
  {
    "inp": "F4",
    "out": "MTFN",
    "descr": "MAGG. TURNI FESTIVI NOTTURNI"
  },
  {
    "inp": "F6",
    "out": "FER6",
    "descr": "FERIE MAGG. 0,20"
  },
  {
    "inp": "F7",
    "out": "MCF",
    "descr": "MAGG. CLAUSOLE FLESSIBILI P.T."
  },
  {
    "inp": "F8",
    "out": "FAP8",
    "descr": "FORMAZIONE ESTERNA C/O SCUOLA"
  },
  {
    "inp": "F9",
    "out": "FAP9",
    "descr": "FORMAZIONE INTERNA C/O AZIENDA 10%"
  },
  {
    "inp": "FA",
    "out": "FLEA",
    "descr": "FLESSIBILITA' ACCANTONATA CON REC."
  },
  {
    "inp": "FB",
    "out": "FELA",
    "descr": "FESTIVITA' LAVORATA"
  },
  {
    "inp": "FC",
    "out": "FMG0",
    "descr": "ORE FORMAZIONE IN CIG 0 ORE"
  },
  {
    "inp": "FD",
    "out": "MNFD",
    "descr": "MAGG. LAV. DOM E FEST DOM"
  },
  {
    "inp": "FE",
    "out": "FERI",
    "descr": "FERIE"
  },
  {
    "inp": "FF",
    "out": "FOR1",
    "descr": "ORE FORMAZIONE PER LA SICUREZZA R.L"
  },
  {
    "inp": "FG",
    "out": "FEGO",
    "descr": "FESTIVITA' GODUTA"
  },
  {
    "inp": "FH",
    "out": "FENA",
    "descr": "FESTIVITA' ACCANTONATE A ROL"
  },
  {
    "inp": "FI",
    "out": "FIS",
    "descr": "FONDO INTEGRAZIONE SALARIALE SENZA"
  },
  {
    "inp": "FL",
    "out": "FLEG",
    "descr": "FLESSIBILITA' GODUTA"
  },
  {
    "inp": "FM",
    "out": "MNF",
    "descr": "MAGG. LAV. NOTT. FESTIVO"
  },
  {
    "inp": "FN",
    "out": "FENG",
    "descr": "FESTIVITA' NON GODUTA"
  },
  {
    "inp": "FO",
    "out": "FERL",
    "descr": "FERIE AD ORE PER MENSILI - NON SCAL"
  },
  {
    "inp": "FP",
    "out": "FEAP",
    "descr": "FERIE GODUTE ANNO PRECEDENTE"
  },
  {
    "inp": "FR",
    "out": "MNFR",
    "descr": "MAGG. NOTTURNO FESTIVO RIPOSO COMPE"
  },
  {
    "inp": "FS",
    "out": "SDSF",
    "descr": "STR. DIU SAB FEST."
  },
  {
    "inp": "FT",
    "out": "MFAC",
    "descr": "MAGG. LAV FEST. ALTRI CASI"
  },
  {
    "inp": "G1",
    "out": "CGDO",
    "descr": "CIG ORDINARIA/EDILI EVENTI ATM. AUT"
  },
  {
    "inp": "G2",
    "out": "CGDS",
    "descr": "CIG STRAORDINARIA AUTORIZZATA"
  },
  {
    "inp": "G3",
    "out": "CGDD",
    "descr": "CIG IN DEROGAAUTORIZZATA"
  },
  {
    "inp": "GA",
    "out": "CG7A",
    "descr": "CIG STRAORDINARIA 70% CON ANTICIPO"
  },
  {
    "inp": "GB",
    "out": "AIO",
    "descr": "ASSEGNO INTEGRAZIONE SALARIALE"
  },
  {
    "inp": "GC",
    "out": "AIOA",
    "descr": "ASSEGNO INTEGRAZIONE SALARIALE AUTO"
  },
  {
    "inp": "GD",
    "out": "AION",
    "descr": "ASSEGNO INTEGRAZIONE SALARIALE SENZ"
  },
  {
    "inp": "GE",
    "out": "AIS",
    "descr": "ASSEGNO INT. SAL CONTRATTO SOLIDARI"
  },
  {
    "inp": "GF",
    "out": "AISA",
    "descr": "ASSEGNO INT.SAL. CONTRATTO SOLIDARI"
  },
  {
    "inp": "GG",
    "out": "AISN",
    "descr": "ASSEGNO INT.SAL. CONTRATTO SOLIDAR."
  },
  {
    "inp": "GN",
    "out": "CG7N",
    "descr": "CIG STRAORDINARIA 70% SENZA ANTICIP"
  },
  {
    "inp": "GP",
    "out": "FEPG",
    "descr": "FESTIVITA' PATRONO GODUTA"
  },
  {
    "inp": "I1",
    "out": "ISU",
    "descr": "INTEGRAZIONE SALARIALE UNICA CON AN"
  },
  {
    "inp": "I2",
    "out": "ISUA",
    "descr": "INTEGRAZIONE SALARIALE UNICA AUTORI"
  },
  {
    "inp": "I3",
    "out": "ISUN",
    "descr": "INTEGRAZIONE SALARIALE UNICA SENZA"
  },
  {
    "inp": "IA",
    "out": "INFA",
    "descr": "INFORTUNIO AUTOMATICO CON CALCOLI U"
  },
  {
    "inp": "ID",
    "out": "IDS",
    "descr": "INIDONEITA' DONAZIONE SANGUE CON MA"
  },
  {
    "inp": "IP",
    "out": "INFP",
    "descr": "MALATTIA PROFESSIONALE CON CALCOLO"
  },
  {
    "inp": "IQ",
    "out": "MALP",
    "descr": "DEPRECATO - MALATTIA PROFESSIONALE"
  },
  {
    "inp": "IR",
    "out": "INFR",
    "descr": "RICADUTA INFORTUNIO"
  },
  {
    "inp": "L0",
    "out": "LSD",
    "descr": "LAVORO SUPPLEMENTARE"
  },
  {
    "inp": "L1",
    "out": "LFES",
    "descr": "LAV.FESTIVO"
  },
  {
    "inp": "L2",
    "out": "LNOT",
    "descr": "LAVORO NOTTURNO"
  },
  {
    "inp": "L3",
    "out": "LNFE",
    "descr": "LAV. NOTT. FEST."
  },
  {
    "inp": "L5",
    "out": "LSAF",
    "descr": "LAVORO SUPPLEMENTARE - GG ANF"
  },
  {
    "inp": "L6",
    "out": "MT6",
    "descr": "MAGG. LAVORO A TURNO 6%"
  },
  {
    "inp": "L7",
    "out": "LSNR",
    "descr": "LAV. SUPPLEMENTARE NOTTURNO PT IN G"
  },
  {
    "inp": "LD",
    "out": "LADO",
    "descr": "LAVORO DOMENICALE RIP. COMP."
  },
  {
    "inp": "LE",
    "out": "LSFE",
    "descr": "LAVORO SUPPLEMENTARE FESTIVO"
  },
  {
    "inp": "LF",
    "out": "LSFT",
    "descr": "LAVORO SUPPLEMENTARE TEMPO PIENO"
  },
  {
    "inp": "LN",
    "out": "LSNO",
    "descr": "LAVORO SUPPLEMENTARE NOTTURNO"
  },
  {
    "inp": "LO",
    "out": "LSO",
    "descr": "LAVORO SUPPLEMENTARE OLTRE LIMITE"
  },
  {
    "inp": "LP",
    "out": "PMLU",
    "descr": "PERMESSO PER LUTTO"
  },
  {
    "inp": "LQ",
    "out": "LSFN",
    "descr": "LAVORO SUPPLEMENTARE FESTIVO NOTTUR"
  },
  {
    "inp": "LS",
    "out": "LS",
    "descr": "LAVORO SUPPLEMENTARE"
  },
  {
    "inp": "LT",
    "out": "MN",
    "descr": "MAGG. LAVORO NOTTURNO"
  },
  {
    "inp": "LV",
    "out": "LSV",
    "descr": "LAVORO SUPPLEMENTARE PER VARIAZIONE"
  },
  {
    "inp": "M0",
    "out": "MA0",
    "descr": "MA0 ART. 32 D.LGS 151/2001"
  },
  {
    "inp": "M1",
    "out": "MA4F",
    "descr": "MA4 ART. 33 COMMA 1 D.LGS 151/2001"
  },
  {
    "inp": "M2",
    "out": "MN22",
    "descr": "MAGG. LAVORO NOTTURNO FINO 22"
  },
  {
    "inp": "M3",
    "out": "MN23",
    "descr": "MAGG. LAVORO NOTTURNO OLTRE 22"
  },
  {
    "inp": "M4",
    "out": "MNAC",
    "descr": "MAGG. LAV NOTT ALTRI CASI"
  },
  {
    "inp": "M5",
    "out": "MA5",
    "descr": "MA5 ART. 42 COMMI 2 E 3 D.LGS 151/2"
  },
  {
    "inp": "M6",
    "out": "MNT6",
    "descr": "MAGG. LAVORO NOTTUNO - TURNO 6X6"
  },
  {
    "inp": "M7",
    "out": "MA7",
    "descr": "MA7 EX ART. 33 COMMA 3 LEGGE 104/19"
  },
  {
    "inp": "M8",
    "out": "MALN",
    "descr": "AUMENTO NUMERO EVENTI MALATTIA"
  },
  {
    "inp": "M9",
    "out": "MRP",
    "descr": "MAGG. RIPOSO PASTI"
  },
  {
    "inp": "MA",
    "out": "MAL",
    "descr": "MALATTIA"
  },
  {
    "inp": "MB",
    "out": "MA3",
    "descr": "MA3 ART. 49 COMMA 1 D.LGS 151/2001"
  },
  {
    "inp": "MC",
    "out": "MC1",
    "descr": "CONGEDO STRAORDINARIO INPS"
  },
  {
    "inp": "MD",
    "out": "MDF",
    "descr": "MAGG. LAVORO FESTIVO"
  },
  {
    "inp": "ME",
    "out": "MA4",
    "descr": "NON UTILIZZARE (VEDERE COMMENTI)"
  },
  {
    "inp": "MF",
    "out": "MATF",
    "descr": "MATERNITA' FACOLTATIVA"
  },
  {
    "inp": "MG",
    "out": "MB0",
    "descr": "MB0 ART. 35 COMMA2 DLGS 151/2001 A"
  },
  {
    "inp": "MH",
    "out": "MA6",
    "descr": "MA6 ART. 33 COMMA 6 D.LEGGE 104"
  },
  {
    "inp": "MI",
    "out": "MB2",
    "descr": "MB2 ART. 35 COMMA2 DLGS 151/2001"
  },
  {
    "inp": "MJ",
    "out": "MDF1",
    "descr": "MAGG. LAV FEST. ALTRI CASI 1"
  },
  {
    "inp": "MK",
    "out": "MALS",
    "descr": "MALATTIA CON CONTINUAZIONE"
  },
  {
    "inp": "ML",
    "out": "MB5",
    "descr": "MB5 ART. 33 COMMA 6 LEGGE 104/1992"
  },
  {
    "inp": "MM",
    "out": "MENS",
    "descr": "INDENNITA' SOSTITUTIVA MENSA"
  },
  {
    "inp": "MN",
    "out": "MATA",
    "descr": "MATERNITA' ANTICIPATA"
  },
  {
    "inp": "MO",
    "out": "MATO",
    "descr": "MATERNITA' OBBLIGATORIA"
  },
  {
    "inp": "MP",
    "out": "MDPU",
    "descr": "MAGG. DOMENICALE PUBBLICI ESERCIZI"
  },
  {
    "inp": "MQ",
    "out": "MB3",
    "descr": "MB3 ART. 42 COMMA 1 DLGS 151/2001"
  },
  {
    "inp": "MR",
    "out": "MALR",
    "descr": "MALATTIA CON RICADUTA"
  },
  {
    "inp": "MS",
    "out": "MNTS",
    "descr": "MAGG. LAVORO NOTTURNO - TURNO STABI"
  },
  {
    "inp": "MT",
    "out": "MNT5",
    "descr": "MAGG. LAVORO NOTTUNO - TURNO 5X8"
  },
  {
    "inp": "MU",
    "out": "MUDI",
    "descr": "MULTA DISCIPLINARE VOCE 0362"
  },
  {
    "inp": "MW",
    "out": "MA7A",
    "descr": "MA7 EX ART.33 COMMA 3 LEGGE 104/199"
  },
  {
    "inp": "MX",
    "out": "MA5A",
    "descr": "MA5 ART.42 COMMI 2 E 3 D.LGS 151/20"
  },
  {
    "inp": "MY",
    "out": "MB4",
    "descr": "MB4 ART. 47 COMMA 2 DLGS 151/2001"
  },
  {
    "inp": "MZ",
    "out": "MA6A",
    "descr": "MA6 ART. 33 COMMA 6 D.LEGGE 104"
  },
  {
    "inp": "N1",
    "out": "MALC",
    "descr": "MALATTIA CHIUSA"
  },
  {
    "inp": "N2",
    "out": "MNL1",
    "descr": "MAGG. LAVORO SUPPL NOTTURNO"
  },
  {
    "inp": "N3",
    "out": "MT26",
    "descr": "MAGG. TURNI NOTTURNI 26%"
  },
  {
    "inp": "N4",
    "out": "MNL2",
    "descr": "MAGG. LAV. SUPPLEMENT. FESTIVO"
  },
  {
    "inp": "NA",
    "out": "SNDF",
    "descr": "STR. NOTT.DOM. FEST."
  },
  {
    "inp": "NB",
    "out": "SNS",
    "descr": "STR. NOTT. SAB."
  },
  {
    "inp": "NC",
    "out": "SNFC",
    "descr": "STR. NOTT. FEST. ALTRI CASI"
  },
  {
    "inp": "ND",
    "out": "SND",
    "descr": "STR. NOTT.DOMENICA"
  },
  {
    "inp": "NE",
    "out": "SNSF",
    "descr": "STR NOTT. SAB FEST."
  },
  {
    "inp": "NF",
    "out": "SNF",
    "descr": "STR. NOTT. FEST."
  },
  {
    "inp": "NI",
    "out": "NIND",
    "descr": "GG NON INDENNIZZATI IN MALATTIA PER"
  },
  {
    "inp": "NM",
    "out": "MNT3",
    "descr": "MAGG. TURNO NOTTURNO -3X7 CICLO C"
  },
  {
    "inp": "NO",
    "out": "MTN",
    "descr": "MAGG. TURNI NOTTURNI"
  },
  {
    "inp": "NP",
    "out": "FEPN",
    "descr": "FESTIVITA' PATRONO NON GODUTA"
  },
  {
    "inp": "NR",
    "out": "SNR",
    "descr": "STR. NOTT. RIP.COMP."
  },
  {
    "inp": "NS",
    "out": "SNT",
    "descr": "STR. NOTT. IN TURNO"
  },
  {
    "inp": "NT",
    "out": "MNT",
    "descr": "MAGG. TURNI NOTTURNI"
  },
  {
    "inp": "NZ",
    "out": "RCNG",
    "descr": "RIPOSO NON GODUTO PER ELEZIONI"
  },
  {
    "inp": "O2",
    "out": "DMO2",
    "descr": "DON. MIDOLLO OSSEO SENZA MAGG 1,20"
  },
  {
    "inp": "OC",
    "out": "COCL",
    "descr": "ORE GOR OTI"
  },
  {
    "inp": "OG",
    "out": "GOR",
    "descr": "ORE GOR"
  },
  {
    "inp": "OL",
    "out": "OL",
    "descr": "ORE LAVORATE ORDINARIE"
  },
  {
    "inp": "OM",
    "out": "ORVM",
    "descr": "ORE VIAGGIO VOCE 0125"
  },
  {
    "inp": "OP",
    "out": "MDIS",
    "descr": "MAGG. ORE LAVORATORI DISCONTINUI"
  },
  {
    "inp": "OS",
    "out": "ORVS",
    "descr": "ORE VIAGGIO VOCE 065"
  },
  {
    "inp": "OV",
    "out": "ORVI",
    "descr": "ORE VIAGGIO VOCE 0472"
  },
  {
    "inp": "P1",
    "out": "PRES",
    "descr": "GIORNI PRESENZA"
  },
  {
    "inp": "P3",
    "out": "PMR3",
    "descr": "PERMESSO RETRIBUITO"
  },
  {
    "inp": "P5",
    "out": "PM50",
    "descr": "MAGG. PRIME 50 H FERIALI ANNUE"
  },
  {
    "inp": "P7",
    "out": "PM75",
    "descr": "MAGG. PRIME 75 H FERIALI ANNUE"
  },
  {
    "inp": "P8",
    "out": "MPOF",
    "descr": "MAGG. PROLUNGAMENTO ORARIO PREST. F"
  },
  {
    "inp": "PA",
    "out": "PMLO",
    "descr": "PERM. PER LUTTO GESTITO A ORE ANCHE"
  },
  {
    "inp": "PB",
    "out": "PARL",
    "descr": "P.A.R. AD ORE PER MENSILI - NON SCA"
  },
  {
    "inp": "PC",
    "out": "PCIV",
    "descr": "PERMESSO PROTEZIONE CIVILE"
  },
  {
    "inp": "PD",
    "out": "PDR",
    "descr": "PROCEDURA DI RICOLLOCAZIONE"
  },
  {
    "inp": "PE",
    "out": "PMES",
    "descr": "PERMESSO ESAMI"
  },
  {
    "inp": "PF",
    "out": "POFE",
    "descr": "PROLUNGAMENTO ORARIO PREST. FERIALI"
  },
  {
    "inp": "PG",
    "out": "POFS",
    "descr": "PROLUNGAMENTO ORARIO PREST. FESTIVO"
  },
  {
    "inp": "PH",
    "out": "PONT",
    "descr": "PROLUNGAMENTO ORARIO PREST. NOTTURN"
  },
  {
    "inp": "PI",
    "out": "PMSI",
    "descr": "PERMESSO SINDACALE"
  },
  {
    "inp": "PL",
    "out": "P104",
    "descr": "DA NON UTILZZARE USARE MA7"
  },
  {
    "inp": "PM",
    "out": "PM26",
    "descr": "MAGG. PRIME 26 H FERIALI ANNUE"
  },
  {
    "inp": "PN",
    "out": "PMNR",
    "descr": "PERMESSO NON RETRIBUITO"
  },
  {
    "inp": "PO",
    "out": "PONS",
    "descr": "PROLUNGAMENTO ORARIO PREST. NOTT. F"
  },
  {
    "inp": "PP",
    "out": "PMNS",
    "descr": "PERMESSO NON RETRIBUITO CON COP. PR"
  },
  {
    "inp": "PR",
    "out": "PMRE",
    "descr": "PERMESSO RETRIBUITO"
  },
  {
    "inp": "PS",
    "out": "PMST",
    "descr": "PERMESSO DI STUDIO"
  },
  {
    "inp": "PT",
    "out": "PAP",
    "descr": "CONGEDO PARTO PREMATURO"
  },
  {
    "inp": "PX",
    "out": "PNAT",
    "descr": "PERMESSO ESAMI PRENATALI"
  },
  {
    "inp": "PZ",
    "out": "PMEL",
    "descr": "PERMESSO ELEZIONI"
  },
  {
    "inp": "R1",
    "out": "RS",
    "descr": "RIPOSO SETTIMANALE"
  },
  {
    "inp": "R2",
    "out": "RIOD",
    "descr": "RICOVERO OSPEDALIERO DIMISSIONI"
  },
  {
    "inp": "R3",
    "out": "ROLF",
    "descr": "ACCANTONAMENTO ORE AGGIUNTIVE SCUOL"
  },
  {
    "inp": "RA",
    "out": "SNRD",
    "descr": "STR. NOTT. RIP.C. DO"
  },
  {
    "inp": "RC",
    "out": "RIPO",
    "descr": "RIPOSO COMPENSATIVO"
  },
  {
    "inp": "RD",
    "out": "SDRD",
    "descr": "STR. DIURNO RIP. C.DO"
  },
  {
    "inp": "RE",
    "out": "ROLE",
    "descr": "R.O.L. EDILI INDUSTRIA OPERAI"
  },
  {
    "inp": "RF",
    "out": "SDRF",
    "descr": "STR. DIU. RIP.C.FEST"
  },
  {
    "inp": "RL",
    "out": "ROL",
    "descr": "RIDUZIONE ORARIO LAVORO"
  },
  {
    "inp": "RM",
    "out": "MDFR",
    "descr": "MAGG. LAV. FES. RIP. COMP."
  },
  {
    "inp": "RO",
    "out": "RIOS",
    "descr": "RICOVERO OSPEDALIERO"
  },
  {
    "inp": "RP",
    "out": "MRIP",
    "descr": "MAGG. LAV. RIP. COMP."
  },
  {
    "inp": "RR",
    "out": "ROLL",
    "descr": "R.O.L. AD ORE PER MENSILI - NON SCA"
  },
  {
    "inp": "RS",
    "out": "SDRS",
    "descr": "STR. DIU RIP.C. SAB."
  },
  {
    "inp": "RV",
    "out": "SNRF",
    "descr": "STR. NOTT.RIP.C.FEST"
  },
  {
    "inp": "RZ",
    "out": "PAR",
    "descr": "PERMESSI ANNUI RETRIBUITI"
  },
  {
    "inp": "S1",
    "out": "SOLF",
    "descr": "FERIE CONTO SOLIDARIETA'"
  },
  {
    "inp": "S2",
    "out": "SOLP",
    "descr": "ROL CONTO SOLIDARIETA'"
  },
  {
    "inp": "S3",
    "out": "SOLE",
    "descr": "EX FEST CONTO SOLIDARIETA'"
  },
  {
    "inp": "S4",
    "out": "MSB1",
    "descr": "MAGG. ORE SABATO"
  },
  {
    "inp": "S6",
    "out": "SD6",
    "descr": "STR. DIURNO 6^ GIORN"
  },
  {
    "inp": "S7",
    "out": "SON",
    "descr": "SOLIDARIETA' CON ANTICIPO"
  },
  {
    "inp": "S8",
    "out": "SONA",
    "descr": "SOLIDARIETA'AUTORIZZATA"
  },
  {
    "inp": "S9",
    "out": "SONI",
    "descr": "SOLIDARIETA' SENZA ANTICIPO"
  },
  {
    "inp": "SA",
    "out": "SAPP",
    "descr": "SCUOLA APPRENDISTI"
  },
  {
    "inp": "SB",
    "out": "MSB",
    "descr": "MAGG. ORE SABATO"
  },
  {
    "inp": "SC",
    "out": "SCIO",
    "descr": "SCIOPERO"
  },
  {
    "inp": "SD",
    "out": "SD",
    "descr": "STR. DIURNO"
  },
  {
    "inp": "SE",
    "out": "SOL",
    "descr": "SOLIDARIETA' CON ANTICIPO"
  },
  {
    "inp": "SF",
    "out": "SDF",
    "descr": "STR. DIURNO FEST."
  },
  {
    "inp": "SG",
    "out": "SDFC",
    "descr": "STR. DIURNO FESTIVO ALTRI CASI"
  },
  {
    "inp": "SH",
    "out": "SH",
    "descr": "STR. DIURNO ALTRI CASI"
  },
  {
    "inp": "SI",
    "out": "SOLI",
    "descr": "SOLIDARIETA' CON ANTICIPO FIG."
  },
  {
    "inp": "SJ",
    "out": "SOLJ",
    "descr": "FERIE CONTO SOLIDARIETA' CONANTIC"
  },
  {
    "inp": "SK",
    "out": "SOLK",
    "descr": "ROL CONTO SOLIDARIETA' CONANTICIP"
  },
  {
    "inp": "SL",
    "out": "SLEV",
    "descr": "SERVIZIO DI LEVA"
  },
  {
    "inp": "SM",
    "out": "SOLM",
    "descr": "EX FEST CONTO SOLIDARIETA' CON ANTI"
  },
  {
    "inp": "SN",
    "out": "SN",
    "descr": "STR. NOTT. NO TURNO"
  },
  {
    "inp": "SO",
    "out": "SOST",
    "descr": "SOSTA A TURNO VOCE 538"
  },
  {
    "inp": "SP",
    "out": "SNRS",
    "descr": "STR. NOTT.RIP.C. SAB"
  },
  {
    "inp": "SQ",
    "out": "SOSQ",
    "descr": "SOSPENSIONE LAVORO CON SABATO E DOM"
  },
  {
    "inp": "SR",
    "out": "SDR",
    "descr": "STR. DIURNO RIP.COM."
  },
  {
    "inp": "SS",
    "out": "SDS",
    "descr": "STR. DIURNO DI SAB."
  },
  {
    "inp": "ST",
    "out": "SNC",
    "descr": "STR. NOTT. (NO TURNI) ALTRI CASI"
  },
  {
    "inp": "SW",
    "out": "SMWO",
    "descr": "SMART WORKING"
  },
  {
    "inp": "SX",
    "out": "SOSP",
    "descr": "SOSPENSIONE LAVORO"
  },
  {
    "inp": "SZ",
    "out": "SOLA",
    "descr": "SOLIDARIETA'AUTORIZZATA"
  },
  {
    "inp": "T1",
    "out": "MLT1",
    "descr": "MAGG. LAVORO A TERMINE FINO A 1 MES"
  },
  {
    "inp": "T2",
    "out": "MLT2",
    "descr": "MAGG. LAVORO A TERMINE FINO A 2 MES"
  },
  {
    "inp": "T3",
    "out": "MLT3",
    "descr": "MAGG. LAVORO A TERMINE OLTRE 2 MESI"
  },
  {
    "inp": "T4",
    "out": "MLT",
    "descr": "MAGG. LAVORO A TERMINE"
  },
  {
    "inp": "T7",
    "out": "TRD",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "T8",
    "out": "TRE",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TA",
    "out": "TR1",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TB",
    "out": "TR2",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TC",
    "out": "TR3",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TD",
    "out": "TR4",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TE",
    "out": "TRA5",
    "descr": "INDENNITA' DI TRASFERTA VOCE 459"
  },
  {
    "inp": "TF",
    "out": "TR5",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TG",
    "out": "TRA6",
    "descr": "INDENNITA' DI TRASFERTA VOCE 460"
  },
  {
    "inp": "TH",
    "out": "TRA7",
    "descr": "INDENNITA' DI TRASFERTA VOCE 461"
  },
  {
    "inp": "TI",
    "out": "TR6",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TJ",
    "out": "MDT2",
    "descr": "MAGG. TURNI DIURNI ALTRI CASI"
  },
  {
    "inp": "TK",
    "out": "TRA8",
    "descr": "INDENNITA' DI TRASFERTA VOCE 462"
  },
  {
    "inp": "TL",
    "out": "TR7",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TM",
    "out": "MDT",
    "descr": "MAGG. TURNI DIURNI"
  },
  {
    "inp": "TN",
    "out": "TR8",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TO",
    "out": "TR9",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TP",
    "out": "TRAG",
    "descr": "INDENNITA' DI TRASFERTA VOCE 452"
  },
  {
    "inp": "TQ",
    "out": "TRA",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TR",
    "out": "TRAF",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TS",
    "out": "TRB",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "TT",
    "out": "TRA1",
    "descr": "INDENNITA' DI TRASFERTA VOCE 494"
  },
  {
    "inp": "TU",
    "out": "TRA2",
    "descr": "INDENNITA' DI TRASFERTA VOCE 495"
  },
  {
    "inp": "TV",
    "out": "TRA3",
    "descr": "INDENNITA' DI TRASFERTA VOCE 496"
  },
  {
    "inp": "TW",
    "out": "TRAI",
    "descr": "INDENNITA' DI TRASFERTA VOCE 454"
  },
  {
    "inp": "TX",
    "out": "TRAH",
    "descr": "INDENNITA' DI TRASFERTA VOCE 453"
  },
  {
    "inp": "TY",
    "out": "TRA4",
    "descr": "INDENNITA' DI TRASFERTA VOCE 497"
  },
  {
    "inp": "TZ",
    "out": "TRC",
    "descr": "INDENNITA' DI TRASFERTA VOCE 451"
  },
  {
    "inp": "U0",
    "out": "FM00",
    "descr": "Riporto in UniEMens il C.F. dipende"
  },
  {
    "inp": "U1",
    "out": "FM01",
    "descr": "Riporto in UniEMens il C.F. coniuge"
  },
  {
    "inp": "U2",
    "out": "FM02",
    "descr": "Riporto in UniEMens il C.F. fam.02"
  },
  {
    "inp": "U3",
    "out": "FM03",
    "descr": "Riporto in UniEMens il C.F. fam.03"
  },
  {
    "inp": "U4",
    "out": "FM04",
    "descr": "Riporto in UniEMens il C.F. fam.04"
  },
  {
    "inp": "U5",
    "out": "FM05",
    "descr": "Riporto in UniEMens il C.F. fam.05"
  },
  {
    "inp": "U6",
    "out": "FM06",
    "descr": "Riporto in UniEMens il C.F. fam.06"
  },
  {
    "inp": "U7",
    "out": "FM07",
    "descr": "Riporto in UniEMens il C.F. fam.07"
  },
  {
    "inp": "U8",
    "out": "FM08",
    "descr": "Riporto in UniEMens il C.F. fam.08"
  },
  {
    "inp": "U9",
    "out": "FM09",
    "descr": "Riporto in UniEMens il C.F. fam.09"
  },
  {
    "inp": "UA",
    "out": "FM10",
    "descr": "Riporto in UniEMens il C.F. fam.10"
  },
  {
    "inp": "UB",
    "out": "FM11",
    "descr": "Riporto in UniEMens il C.F. fam.11"
  },
  {
    "inp": "UC",
    "out": "FM12",
    "descr": "Riporto in UniEMens il C.F. fam.12"
  },
  {
    "inp": "UD",
    "out": "FM13",
    "descr": "Riporto in UniEMens il C.F. fam.13"
  },
  {
    "inp": "UE",
    "out": "FM14",
    "descr": "Riporto in UniEMens il C.F. fam.14"
  },
  {
    "inp": "UF",
    "out": "FM15",
    "descr": "Riporto in UniEMens il C.F. fam.15"
  },
  {
    "inp": "V1",
    "out": "TER",
    "descr": "CICLO TERAPIA"
  },
  {
    "inp": "VE",
    "out": "VMPE",
    "descr": "VISITA MEDICA PERIODICA EDILI"
  },
  {
    "inp": "VG",
    "out": "ORVG",
    "descr": "ORE VIAGGIO VOCE 0472 - SCALA GG/H"
  },
  {
    "inp": "VM",
    "out": "PMCM",
    "descr": "PERMESSO PER CURE MEDICHE"
  },
  {
    "inp": "WO",
    "out": "OLE",
    "descr": "ORE LAVORATE EDILI - MULTICANTIERE"
  },
  {
    "inp": "YD",
    "out": "IDS2",
    "descr": "INIDONEITA' DONAZIONE SANGUE A ORE"
  }
];

/** Lookup by 2-char input code (the stored mapping value). */
export const CENTRO_PAGHE_BY_INP: Readonly<Record<string, CentroPagheCode>> =
  Object.fromEntries(CENTRO_PAGHE_CODES.map((c) => [c.inp, c]));
