const { fetchAndSolveCaptcha } = require('./captchaSolver');
const {
  hospitalRequest,
  selectHospital,
  setVariables
} = require('./hospitalClient');
const {
  normalizeStructuredData,
  parseAppointmentApprove,
  parseAppointmentCode,
  parseAppointmentTimeResponse
} = require('./parsers');

const HOSPITALS = {
  2: 'Hayat Hastahanesi',
  4: 'Aktif Yasam Tip Merkezi',
  5: 'Urotas Hayat Tip Merkezi',
  6: 'Pendik Sifa Hastahanesi'
};

function requireField(body, fieldName) {
  if (body[fieldName] === undefined || body[fieldName] === null || body[fieldName] === '') {
    throw new Error(`Missing ${fieldName}`);
  }

  return body[fieldName];
}

function asTenDigitPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length !== 10) {
    throw new Error('phone must be 10 digits');
  }

  return digits;
}

function normalizeGender(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'ERKEK' || normalized === 'E') {
    return 'E';
  }

  if (normalized === 'KADIN' || normalized === 'K') {
    return 'K';
  }

  return normalized;
}

function normalizeGenderLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'E' || normalized === 'ERKEK') {
    return 'ERKEK';
  }

  if (normalized === 'K' || normalized === 'KADIN') {
    return 'KADIN';
  }

  return normalized;
}

function normalizeAppointmentDay(value) {
  const day = String(value).trim();
  const isoDateMatch = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!isoDateMatch) {
    return day;
  }

  return `${isoDateMatch[3]}.${isoDateMatch[2]}.${isoDateMatch[1]}`;
}

function getBirthDateParts(value) {
  const birthDate = String(value).trim();
  const isoDateMatch = birthDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dottedDateMatch = birthDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (isoDateMatch) {
    return {
      birth_date: `${isoDateMatch[1]}-${isoDateMatch[2].padStart(2, '0')}-${isoDateMatch[3].padStart(2, '0')}`,
      dotted_birth_date: `${isoDateMatch[3].padStart(2, '0')}.${isoDateMatch[2].padStart(2, '0')}.${isoDateMatch[1]}`,
      birth_day: Number(isoDateMatch[3]),
      birth_month: Number(isoDateMatch[2]),
      birth_year: Number(isoDateMatch[1])
    };
  }

  if (dottedDateMatch) {
    return {
      birth_date: `${dottedDateMatch[3]}-${dottedDateMatch[2].padStart(2, '0')}-${dottedDateMatch[1].padStart(2, '0')}`,
      dotted_birth_date: `${dottedDateMatch[1].padStart(2, '0')}.${dottedDateMatch[2].padStart(2, '0')}.${dottedDateMatch[3]}`,
      birth_day: Number(dottedDateMatch[1]),
      birth_month: Number(dottedDateMatch[2]),
      birth_year: Number(dottedDateMatch[3])
    };
  }

  throw new Error('birth_date must be YYYY-MM-DD or DD.MM.YYYY');
}

function buildPatientPayload(body) {
  const gender = normalizeGenderLabel(requireField(body, 'gender'));
  const phone = asTenDigitPhone(requireField(body, 'phone'));
  const birthDate = getBirthDateParts(requireField(body, 'birth_date'));

  return {
    hd_patient_type: body.patient_type || 1,
    fr_identity_no: requireField(body, 'identity_no'),
    fr_passport: body.passport || '',
    fr_name: requireField(body, 'name'),
    fr_surname: requireField(body, 'surname'),
    fr_sexuality_view: gender,
    fr_sexuality: gender,
    fr_birth_date: birthDate.dotted_birth_date,
    fr_father_name: requireField(body, 'father_name'),
    fr_mother_name: requireField(body, 'mother_name'),
    fr_mp_country_code: body.mobile_country_code || 127,
    fr_mobile_phone: phone,
    fr_hp_country_code: body.home_country_code || '',
    fr_home_phone: body.home_phone || '',
    fr_wp_country_code: body.work_country_code || '',
    fr_work_phone: body.work_phone || '',
    fr_email: body.email || '',
    fr_city_view: body.city_name || '',
    fr_city: requireField(body, 'city_id'),
    fr_cn_id_view: body.county_name || '',
    fr_cn_id: body.county_id || '',
    fr_quarter_name: body.quarter_name || '',
    fr_address: body.address || '',
    fr_outer_door_no: body.outer_door_no || '',
    fr_inner_door_no: body.inner_door_no || '',
    fr_association_id_view: body.association_name || '',
    fr_association_id: requireField(body, 'association_id')
  };
}

async function getPatientInfoWithCaptcha(session, config, body) {
  const identityNo = requireField(body, 'identity_no');
  const fatherName = requireField(body, 'father_name');
  const birthDate = getBirthDateParts(requireField(body, 'birth_date'));

  let lastResponse = null;

  for (let attempt = 1; attempt <= config.captchaMaxAttempts; attempt += 1) {
    const captcha = await fetchAndSolveCaptcha(session, hospitalRequest, config.baseUrl);
    const response = await hospitalRequest(session, {
      baseUrl: config.baseUrl,
      path: '/get_patient_info.php',
      query: {
        hd_father_name: 1,
        hd_birth_date: 1,
        hd_patient_type: 1,
        fr_identity_no: identityNo,
        fr_passport: body.passport || '',
        fr_father_name: fatherName,
        fr_birth_date: birthDate.birth_date,
        fr_birth_day: birthDate.birth_day,
        fr_birth_month: birthDate.birth_month,
        fr_birth_year: birthDate.birth_year,
        fr_secure_code: captcha.text
      }
    });

    const normalized = normalizeStructuredData(response.data);
    lastResponse = normalized;

    if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
      if (Number(normalized.secure_pass) === 0) {
        continue;
      }

      return normalized;
    }

    if (typeof normalized === 'string' && /secure_pass["'=:\s]+0/i.test(normalized)) {
      continue;
    }

    return normalized;
  }

  throw new Error(`Captcha validation failed after ${config.captchaMaxAttempts} attempts: ${JSON.stringify(lastResponse)}`);
}

function actionHandlers(config) {
  return {
    async get_departments(session, body) {
      const hospitalId = Number(requireField(body, 'hospital_id'));

      if (!HOSPITALS[hospitalId]) {
        throw new Error('Unsupported hospital_id');
      }

      await selectHospital(session, {
        baseUrl: config.baseUrl,
        hospitalId
      });

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_departments.php',
        query: {
          off_id: hospitalId
        }
      });

      return {
        hospital_id: hospitalId,
        hospital_name: HOSPITALS[hospitalId],
        items: normalizeStructuredData(response.data)
      };
    },

    async get_doctors(session, body) {
      const departmentId = requireField(body, 'department_id');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_doctors.php',
        query: {
          bc_id: departmentId
        }
      });

      return {
        department_id: departmentId,
        items: normalizeStructuredData(response.data)
      };
    },

    async get_days(session) {
      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_days.php'
      });

      return {
        items: normalizeStructuredData(response.data)
      };
    },

    async get_appointment_time(session, body) {
      const doctorId = requireField(body, 'doctor_id');
      const deptId = requireField(body, 'dept_id');
      const day = normalizeAppointmentDay(requireField(body, 'day'));

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/get_appointment_time.php',
        query: {
          dr_id: doctorId,
          dept_id: deptId,
          day
        }
      });

      if (response.status >= 400) {
        throw new Error(`Hospital appointment time request failed with status ${response.status}`);
      }

      return {
        doctor_id: doctorId,
        dept_id: deptId,
        day,
        items: parseAppointmentTimeResponse(response.data)
      };
    },

    async set_appointment_time(session, body) {
      const aopId = requireField(body, 'aop_id');
      const appType = requireField(body, 'app_type');

      const response = await setVariables(session, {
        baseUrl: config.baseUrl,
        vars: 'aop_id|app_type',
        vals: `${aopId}|${appType}`
      });

      return {
        aop_id: Number(aopId),
        app_type: Number(appType),
        result: normalizeStructuredData(response.data)
      };
    },

    async get_patient_info(session, body) {
      const result = await getPatientInfoWithCaptcha(session, config, body);

      return {
        identity_no: body.identity_no,
        result
      };
    },

    async create_patient(session, body) {
      const payload = buildPatientPayload(body);

      const registerPage = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/new_patient_register.php'
      });

      if (registerPage.status >= 400) {
        throw new Error(`Hospital patient register page failed with status ${registerPage.status}`);
      }

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/insert_patient.php',
        query: payload
      });

      if (response.status >= 400) {
        throw new Error(`Hospital patient insert request failed with status ${response.status}`);
      }

      return {
        identity_no: body.identity_no,
        result: normalizeStructuredData(response.data)
      };
    },

    async get_counties(session, body) {
      const cityId = requireField(body, 'city_id');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/county_list.php',
        query: {
          city_id: cityId
        }
      });

      return {
        city_id: Number(cityId),
        items: normalizeStructuredData(response.data)
      };
    },

    async send_sms(session, body) {
      const pnId = requireField(body, 'pn_id');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/send_sms.php',
        query: {
          pn_id: pnId
        }
      });

      return {
        pn_id: Number(pnId),
        result: normalizeStructuredData(response.data)
      };
    },

    async check_verification_code(session, body) {
      const verificationCode = requireField(body, 'verification_code');

      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/check_verification_code.php',
        query: {
          fr_verification_code: verificationCode
        }
      });

      return {
        verification_code: verificationCode,
        result: normalizeStructuredData(response.data)
      };
    },

    async get_appointment_approve(session) {
      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/appointment_approve.php'
      });

      return parseAppointmentApprove(response.data);
    },

    async approve_appointment(session) {
      const response = await hospitalRequest(session, {
        baseUrl: config.baseUrl,
        path: '/insert_appointment.php'
      });

      return parseAppointmentCode(response.data);
    }
  };
}

async function runAction(action, session, body, config) {
  const handlers = actionHandlers(config);
  const handler = handlers[action];

  if (!handler) {
    throw new Error('Unknown action');
  }

  return handler(session, body);
}

module.exports = {
  HOSPITALS,
  runAction
};
